import {
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
import { cloneConnectPrefix } from '../src/services/connect-prefix';

async function makePrefix(root: string): Promise<string> {
  const prefix = path.join(root, 'source');
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

  it('refuses to merge into an existing target or clone inside the source', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-prefix-'));
    const source = await makePrefix(root);
    const existing = path.join(root, 'existing');
    await mkdir(existing);

    await expect(
      cloneConnectPrefix(source, existing, { skipProcessCheck: true })
    ).rejects.toThrow(/already exists/);
    await expect(
      cloneConnectPrefix(source, path.join(source, 'nested'), {
        skipProcessCheck: true
      })
    ).rejects.toThrow(/outside the source prefix/);
  });
});
