import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { inspectConnectSetup } from '../src/services/connect-setup';
import { trustUbisoftConnectInstallation } from '../src/services/ubisoft-connect';

async function installFakeClient(prefix: string): Promise<void> {
  const executable = path.join(
    prefix,
    'drive_c',
    'Program Files (x86)',
    'Ubisoft',
    'Ubisoft Game Launcher',
    'UbisoftConnect.exe'
  );
  await mkdir(path.dirname(executable), { recursive: true });
  await chmod(prefix, 0o700);
  await writeFile(executable, 'client');
}

describe('Connect setup inspection', () => {
  it('reports missing, installed, partial, and remembered-auth states offline', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-setup-'));
    const prefix = path.join(root, 'prefix');

    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      prefixExists: false,
      pathSafe: true,
      clientInstalled: false,
      rememberedAuth: 'absent'
    });

    await installFakeClient(prefix);
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      prefixExists: true,
      pathSafe: true,
      prefixSafe: true,
      clientInstalled: true,
      clientTrusted: false,
      rememberedAuth: 'absent'
    });
    await trustUbisoftConnectInstallation(prefix);
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      clientTrusted: true,
      clientProvenance: 'explicit-trust'
    });

    const appData = path.join(
      prefix,
      'drive_c',
      'users',
      'tester',
      'AppData',
      'Local',
      'Ubisoft Game Launcher'
    );
    await mkdir(appData, { recursive: true });
    await writeFile(path.join(appData, 'ConnectSecureStorage.dat'), 'opaque');
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      rememberedAuth: 'partial',
      authEvidence: { secureStorage: true, userState: false }
    });

    await writeFile(path.join(appData, 'user.dat'), 'user');
    const outsideCache = path.join(root, 'outside-cache');
    await mkdir(path.join(outsideCache, 'ownership'), { recursive: true });
    await writeFile(path.join(outsideCache, 'ownership', 'account'), 'outside');
    await symlink(outsideCache, path.join(appData, 'cache'));
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      rememberedAuth: 'partial',
      authEvidence: { ownershipCache: false }
    });
    await rm(path.join(appData, 'cache'));

    const ownership = path.join(appData, 'cache', 'ownership');
    await mkdir(ownership, { recursive: true });
    await writeFile(path.join(ownership, 'account'), 'owned-products');
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      rememberedAuth: 'present',
      authEvidence: {
        secureStorage: true,
        userState: true,
        ownershipCache: true
      }
    });
  });

  it('reports an aliased prefix as unsafe and does not follow auth symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-setup-'));
    const prefix = path.join(root, 'prefix');
    const alias = path.join(root, 'alias');
    await installFakeClient(prefix);
    await symlink(prefix, alias);

    await expect(inspectConnectSetup(alias)).resolves.toMatchObject({
      prefixExists: true,
      pathSafe: false,
      prefixSafe: false,
      clientInstalled: false,
      rememberedAuth: 'absent'
    });
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
    await expect(
      inspectConnectSetup(path.join(alias, 'missing-prefix'))
    ).resolves.toMatchObject({
      prefixExists: false,
      pathSafe: false
    });

    await chmod(prefix, 0o755);
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      prefixExists: true,
      pathSafe: true,
      prefixSafe: false
    });
    await chmod(prefix, 0o700);

    const outsideLocal = path.join(root, 'outside-local');
    const outsideLauncher = path.join(outsideLocal, 'Ubisoft Game Launcher');
    await mkdir(outsideLauncher, { recursive: true });
    await writeFile(
      path.join(outsideLauncher, 'ConnectSecureStorage.dat'),
      'opaque'
    );
    const appData = path.join(prefix, 'drive_c', 'users', 'tester', 'AppData');
    await mkdir(appData, { recursive: true });
    await symlink(outsideLocal, path.join(appData, 'Local'));
    await expect(inspectConnectSetup(prefix)).resolves.toMatchObject({
      rememberedAuth: 'absent',
      authEvidence: { secureStorage: false }
    });
  });
});
