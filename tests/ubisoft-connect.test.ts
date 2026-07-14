import { createHash } from 'node:crypto';
import {
  chmod,
  link,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  assertSafeUbisoftConnectInstallDestinations,
  buildWineProcessSpec,
  findUbisoftConnectExecutable,
  getUbisoftConnectInstallationProvenance,
  isUbisoftConnectInstallationVerified,
  prepareWinePrefix,
  stopUbisoftConnect,
  trustUbisoftConnectInstallation,
  verifyUbisoftConnectInstaller,
  waitForWineProcessLifecycle
} from '../src/services/ubisoft-connect';

function makeSignedPeFixture(): Buffer {
  const buffer = Buffer.alloc(528);
  buffer.write('MZ', 0, 'ascii');
  buffer.writeUInt32LE(0x80, 0x3c);
  buffer.write('PE\0\0', 0x80, 'binary');
  const optionalHeader = 0x80 + 24;
  buffer.writeUInt16LE(0x10b, optionalHeader);
  const securityDirectory = optionalHeader + 96 + 4 * 8;
  buffer.writeUInt32LE(512, securityDirectory);
  buffer.writeUInt32LE(16, securityDirectory + 4);
  buffer.writeUInt32LE(16, 512);
  buffer.writeUInt16LE(0x200, 516);
  buffer.writeUInt16LE(2, 518);
  buffer.fill(0x5a, 520);
  return buffer;
}

describe('Ubisoft Connect bootstrap helpers', () => {
  it('requires both the pinned digest and a PE certificate table', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-'));
    const installer = path.join(root, 'installer.exe');
    const fixture = makeSignedPeFixture();
    const digest = createHash('sha256').update(fixture).digest('hex');
    await writeFile(installer, fixture);

    await expect(
      verifyUbisoftConnectInstaller(installer, digest)
    ).resolves.toEqual({
      sha256: digest,
      size: fixture.length,
      hasAuthenticodeCertificate: true
    });
    await expect(
      verifyUbisoftConnectInstaller(installer, '0'.repeat(64))
    ).rejects.toThrow(/SHA-256 mismatch/);
  });

  it('prepares an owned real directory and rejects a prefix symlink', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-'));
    const prefix = path.join(root, 'prefix');
    await expect(prepareWinePrefix(prefix)).resolves.toBe(prefix);

    const linkedPrefix = path.join(root, 'linked-prefix');
    await symlink(prefix, linkedPrefix);
    await expect(prepareWinePrefix(linkedPrefix)).rejects.toThrow(/symlink/);

    const realParent = path.join(root, 'real-parent');
    const linkedParent = path.join(root, 'linked-parent');
    await mkdir(realParent);
    await symlink(realParent, linkedParent);
    await expect(
      prepareWinePrefix(path.join(linkedParent, 'nested-prefix'))
    ).rejects.toThrow(/symlink/);

    const unrelated = path.join(root, 'unrelated');
    await mkdir(unrelated);
    await writeFile(path.join(unrelated, 'personal-file'), 'keep');
    await expect(prepareWinePrefix(unrelated)).rejects.toThrow(
      /not a recognizable Wine prefix/
    );

    const unsafePrefix = path.join(root, 'unsafe-prefix');
    const outsideInstall = path.join(root, 'outside-install');
    await mkdir(path.join(unsafePrefix, 'drive_c'), { recursive: true });
    await mkdir(outsideInstall);
    await writeFile(path.join(unsafePrefix, 'system.reg'), 'registry');
    await writeFile(path.join(unsafePrefix, 'user.reg'), 'registry');
    await symlink(
      outsideInstall,
      path.join(unsafePrefix, 'drive_c', 'Program Files (x86)')
    );
    await expect(
      assertSafeUbisoftConnectInstallDestinations(unsafePrefix)
    ).rejects.toThrow(/unsafe prefix path component/);

    const unsafeLeafPrefix = path.join(root, 'unsafe-leaf-prefix');
    const unsafeLeaf = path.join(
      unsafeLeafPrefix,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher',
      'UbisoftConnect.exe'
    );
    const outsideExecutable = path.join(root, 'outside.exe');
    await mkdir(path.dirname(unsafeLeaf), { recursive: true });
    await writeFile(outsideExecutable, 'outside');
    await symlink(outsideExecutable, unsafeLeaf);
    await expect(
      assertSafeUbisoftConnectInstallDestinations(unsafeLeafPrefix)
    ).rejects.toThrow(/symlinked existing entry/);

    const hardlinkPrefix = path.join(root, 'hardlink-prefix');
    const hardlinkDirectory = path.join(
      hardlinkPrefix,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher'
    );
    const hardlinkSource = path.join(root, 'hardlink-source.exe');
    await mkdir(hardlinkDirectory, { recursive: true });
    await writeFile(hardlinkSource, 'outside');
    await link(hardlinkSource, path.join(hardlinkDirectory, 'upc.exe'));
    await expect(
      assertSafeUbisoftConnectInstallDestinations(hardlinkPrefix)
    ).rejects.toThrow(/unsafe existing file/);
  });

  it('tracks a game lifecycle and can stop the background client', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-'));
    const runner = path.join(root, 'runner');
    const count = path.join(root, 'count');
    const stopped = path.join(root, 'stopped');
    await writeFile(count, '0');
    await writeFile(
      runner,
      `#!/bin/sh\nif [ "$1" = tasklist ]; then n=$(cat ${JSON.stringify(count)}); n=$((n+1)); echo "$n" > ${JSON.stringify(count)}; if [ "$n" -ge 2 ] && [ "$n" -le 4 ]; then echo Game.exe; fi; elif [ "$1" = taskkill ]; then echo "$*" > ${JSON.stringify(stopped)}; fi\n`
    );
    await chmod(runner, 0o700);

    await expect(
      waitForWineProcessLifecycle(runner, [], root, 'Game.exe', {
        startTimeoutMs: 500,
        absentSettleMs: 15,
        pollIntervalMs: 5
      })
    ).resolves.toBeUndefined();
    await stopUbisoftConnect(runner, [], root);
    await expect(readFile(stopped, 'utf8')).resolves.toContain(
      'taskkill /IM upc.exe'
    );
  });

  it('discovers the standard client path and builds a contained process spec', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-'));
    const client = path.join(
      root,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher',
      'UbisoftConnect.exe'
    );
    await mkdir(path.dirname(client), { recursive: true });
    await writeFile(client, 'test');

    await expect(findUbisoftConnectExecutable(root)).resolves.toBe(client);
    await expect(
      isUbisoftConnectInstallationVerified(root, client)
    ).resolves.toBe(false);
    await trustUbisoftConnectInstallation(root, client);
    await expect(
      isUbisoftConnectInstallationVerified(root, client)
    ).resolves.toBe(true);
    await expect(
      getUbisoftConnectInstallationProvenance(root, client)
    ).resolves.toBe('explicit-trust');
    await expect(prepareWinePrefix(root)).resolves.toBe(root);
    expect(
      (
        await lstat(
          path.join(root, '.ubi-cli', 'verified-connect-install.json')
        )
      ).mode & 0o777
    ).toBe(0o600);

    const spec = buildWineProcessSpec('proton', client, root, ['run']);
    expect(spec.command).toBe('proton');
    expect(spec.args).toEqual(['run', client]);
    expect(spec.cwd).toBe(path.dirname(client));
    expect(spec.env.WINEPREFIX).toBe(root);

    const linkedRoot = await mkdtemp(path.join(tmpdir(), 'ubi-connect-'));
    const linkedClient = path.join(
      linkedRoot,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher',
      'UbisoftConnect.exe'
    );
    await mkdir(path.dirname(linkedClient), { recursive: true });
    await symlink(client, linkedClient);
    await expect(
      findUbisoftConnectExecutable(linkedRoot)
    ).resolves.toBeUndefined();

    const markerRoot = await mkdtemp(path.join(tmpdir(), 'ubi-connect-'));
    const markerClient = path.join(
      markerRoot,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher',
      'UbisoftConnect.exe'
    );
    const outsideMarker = path.join(markerRoot, 'outside-marker');
    await mkdir(path.dirname(markerClient), { recursive: true });
    await mkdir(outsideMarker);
    await writeFile(markerClient, 'client');
    await symlink(outsideMarker, path.join(markerRoot, '.ubi-cli'));
    await expect(
      trustUbisoftConnectInstallation(markerRoot, markerClient)
    ).rejects.toThrow(/symlinked/);
  });
});
