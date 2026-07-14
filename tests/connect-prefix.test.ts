import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  readlink,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  cloneConnectPrefix,
  migrateConnectAuthentication
} from '../src/services/connect-prefix';

async function makePrefix(root: string, name = 'source'): Promise<string> {
  const prefix = path.join(root, name);
  const client = path.join(
    prefix,
    'drive_c',
    'Program Files (x86)',
    'Ubisoft',
    'Ubisoft Game Launcher',
    'UbisoftConnect.exe'
  );
  await mkdir(path.dirname(client), { recursive: true });
  await mkdir(path.join(prefix, 'dosdevices'));
  await writeFile(client, 'client');
  await writeFile(path.join(prefix, 'remembered-auth.bin'), 'sensitive');
  await symlink('/', path.join(prefix, 'dosdevices', 'z:'));
  return prefix;
}

describe('Connect prefix cloning', () => {
  it('creates an owner-only complete clone without dereferencing Wine symlinks', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-prefix-'));
    const source = await makePrefix(root);
    const target = path.join(root, 'target');

    await expect(
      cloneConnectPrefix(source, target, {
        reflinkOnly: false,
        skipProcessCheck: true
      })
    ).resolves.toMatchObject({
      sourcePrefix: source,
      targetPrefix: target,
      reflinkRequired: false
    });
    expect((await lstat(target)).mode & 0o777).toBe(0o700);
    await expect(
      readFile(path.join(target, 'remembered-auth.bin'), 'utf8')
    ).resolves.toBe('sensitive');
    await expect(readlink(path.join(target, 'dosdevices', 'z:'))).resolves.toBe(
      '/'
    );
  });

  it('migrates official client AppData and its Wine device binding into a stopped target', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-prefix-'));
    const source = await makePrefix(root, 'source');
    const target = await makePrefix(root, 'target');
    const relativeAppData = path.join(
      'drive_c',
      'users',
      'kurt',
      'AppData',
      'Local',
      'Ubisoft Game Launcher'
    );
    const sourceAppData = path.join(source, relativeAppData);
    const targetAppData = path.join(target, relativeAppData);
    await mkdir(sourceAppData, { recursive: true });
    await mkdir(targetAppData, { recursive: true });
    await writeFile(path.join(sourceAppData, 'auth-state.bin'), 'official');
    await writeFile(
      path.join(sourceAppData, 'ConnectSecureStorage.dat'),
      'opaque'
    );
    await writeFile(path.join(sourceAppData, 'user.dat'), 'client-state');
    await writeFile(path.join(targetAppData, 'old-state.bin'), 'old');
    await writeFile(
      path.join(source, '.machine-guid'),
      '11111111-1111-1111-1111-111111111111'
    );
    await writeFile(
      path.join(target, '.machine-guid'),
      '22222222-2222-2222-2222-222222222222'
    );

    const runner = path.join(root, 'fake-wine');
    await writeFile(
      runner,
      `#!/bin/sh
case "$1" in
  tasklist) exit 0 ;;
  cmd) printf 'C:\\\\users\\\\kurt\\\\AppData\\\\Local\\r\\n'; exit 0 ;;
  reg)
    if [ "$2" = query ]; then
      printf '    MachineGuid    REG_SZ    '
      cat "$WINEPREFIX/.machine-guid"
      exit 0
    fi
    if [ "$2" = import ]; then
      tr -d '\\r' < "$3" | sed -n 's/^"MachineGuid"="\\([^"]*\\)"$/\\1/p' > "$WINEPREFIX/.machine-guid"
      exit 0
    fi
    ;;
esac
exit 1
`
    );
    await chmod(runner, 0o700);

    await expect(
      migrateConnectAuthentication(source, target, { runner })
    ).resolves.toMatchObject({
      sourcePrefix: source,
      targetPrefix: target,
      appDataMigrated: true,
      machineGuidMigrated: true
    });
    await expect(
      readFile(path.join(targetAppData, 'auth-state.bin'), 'utf8')
    ).resolves.toBe('official');
    await expect(
      readFile(path.join(targetAppData, 'old-state.bin'), 'utf8')
    ).rejects.toThrow();
    await expect(
      readFile(path.join(target, '.machine-guid'), 'utf8')
    ).resolves.toBe('11111111-1111-1111-1111-111111111111\n');
    expect((await lstat(targetAppData)).mode & 0o777).toBe(0o700);

    const lockPath = path.join(
      path.dirname(target),
      `.${path.basename(target)}.connect-auth.lock`
    );
    await writeFile(lockPath, 'held', { mode: 0o600 });
    await expect(
      migrateConnectAuthentication(source, target, { runner })
    ).rejects.toThrow(/Another authentication migration or prefix clone/);
    await expect(readFile(lockPath, 'utf8')).resolves.toBe('held');
  });

  it('refuses existing, nested, or symlink-aliased prefix paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-prefix-'));
    const source = await makePrefix(root);
    const existing = path.join(root, 'existing');
    const aliasedRoot = `${root}-alias`;
    await mkdir(existing);
    await symlink(root, aliasedRoot);

    await expect(
      cloneConnectPrefix(source, existing, { skipProcessCheck: true })
    ).rejects.toThrow(/already exists/);
    await expect(
      cloneConnectPrefix(source, path.join(source, 'nested'), {
        skipProcessCheck: true
      })
    ).rejects.toThrow(/outside the source prefix/);
    await expect(
      cloneConnectPrefix(
        path.join(aliasedRoot, 'source'),
        path.join(root, 'new'),
        {
          skipProcessCheck: true
        }
      )
    ).rejects.toThrow(/real directory/);
  });
});
