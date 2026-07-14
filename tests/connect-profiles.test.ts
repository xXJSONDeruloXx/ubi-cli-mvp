import { lstat, mkdtemp, mkdir, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  emptyConnectProfileStore,
  loadConnectProfiles,
  resolveProfileWinePrefix,
  saveConnectProfiles,
  updateConnectProfiles
} from '../src/services/connect-profiles';

describe('Connect profile store', () => {
  it('atomically persists only non-secret path/product metadata', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-profiles-'));
    const storePath = path.join(root, 'data', 'connect-profiles.json');
    const store = emptyConnectProfileStore();
    store.defaultWinePrefix = path.join(root, 'prefix');
    store.games['109'] = {
      productId: '109',
      installDir: path.join(root, 'game'),
      executable: 'system/SplinterCell.exe'
    };

    await saveConnectProfiles(storePath, store);
    await expect(loadConnectProfiles(storePath)).resolves.toEqual(store);
    expect((await lstat(storePath)).mode & 0o777).toBe(0o600);
    expect(resolveProfileWinePrefix(store, '109')).toBe(
      store.defaultWinePrefix
    );
  });

  it('serializes read-modify-write profile updates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-profiles-'));
    const storePath = path.join(root, 'data', 'connect-profiles.json');
    await updateConnectProfiles(storePath, (store) => {
      store.defaultWinePrefix = '/prefix';
    });
    await expect(loadConnectProfiles(storePath)).resolves.toMatchObject({
      defaultWinePrefix: '/prefix'
    });

    const lockPath = path.join(
      path.dirname(storePath),
      `.${path.basename(storePath)}.lock`
    );
    await writeFile(lockPath, 'held', { mode: 0o600 });
    await expect(
      updateConnectProfiles(storePath, (store) => {
        store.defaultWinePrefix = '/other';
      })
    ).rejects.toThrow(/Another process/);
    await expect(loadConnectProfiles(storePath)).resolves.toMatchObject({
      defaultWinePrefix: '/prefix'
    });
  });

  it('supports a product-specific prefix override', () => {
    const store = emptyConnectProfileStore();
    store.defaultWinePrefix = '/default';
    store.games['109'] = {
      productId: '109',
      installDir: '/game',
      winePrefix: '/specific'
    };
    expect(resolveProfileWinePrefix(store, '109')).toBe('/specific');
    expect(() => resolveProfileWinePrefix(store, '110')).toThrow(
      /No Connect profile/
    );
  });

  it('rejects a symlinked profile store', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-profiles-'));
    const target = path.join(root, 'target.json');
    const linked = path.join(root, 'profiles.json');
    await writeFile(target, '{"version":1,"games":{}}');
    await symlink(target, linked);
    await expect(loadConnectProfiles(linked)).rejects.toThrow(/regular file/);
  });

  it('rejects unsafe executable paths and malformed product IDs', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-profiles-'));
    const storePath = path.join(root, 'profiles.json');
    await mkdir(path.dirname(storePath), { recursive: true });
    await writeFile(
      storePath,
      JSON.stringify({
        version: 1,
        games: {
          invalid: {
            productId: 'invalid',
            installDir: '/game',
            executable: '../escape.exe'
          }
        }
      })
    );
    await expect(loadConnectProfiles(storePath)).rejects.toThrow(
      /invalid game/
    );
  });
});
