import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  buildWineProcessSpec,
  findUbisoftConnectExecutable,
  prepareWinePrefix,
  verifyUbisoftConnectInstaller
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
    const spec = buildWineProcessSpec('proton', client, root, ['run']);
    expect(spec.command).toBe('proton');
    expect(spec.args).toEqual(['run', client]);
    expect(spec.cwd).toBe(path.dirname(client));
    expect(spec.env.WINEPREFIX).toBe(root);
  });
});
