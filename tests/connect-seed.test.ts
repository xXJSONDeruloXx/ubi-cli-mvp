import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  symlink,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  seedConnectDownload,
  waitForConnectFinalization,
  wineInstallPathToHostPath
} from '../src/services/connect-seed';

describe('Connect paused-download seeding', () => {
  it('maps only contained C: install paths into the selected prefix', () => {
    const prefix = path.resolve('/tmp/connect-prefix');
    expect(
      wineInstallPathToHostPath(
        prefix,
        'C:/Program Files/Ubisoft/Games/Splinter Cell/'
      )
    ).toBe(
      path.join(
        prefix,
        'drive_c',
        'Program Files',
        'Ubisoft',
        'Games',
        'Splinter Cell'
      )
    );
    expect(() => wineInstallPathToHostPath(prefix, 'Z:/tmp/game')).toThrow(
      /Only C: paths/
    );
    expect(() => wineInstallPathToHostPath(prefix, 'C:/../../escape')).toThrow(
      /outside/
    );
  });

  it('dry-runs, skips matching files, and atomically seeds mismatches', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-seed-'));
    const sourceDir = path.join(root, 'source');
    const registeredInstallDir = path.join(root, 'registered');
    const stagingDir = path.join(registeredInstallDir, 'uplay_download', '109');
    await mkdir(path.join(sourceDir, 'system'), { recursive: true });
    await mkdir(path.join(stagingDir, 'system'), { recursive: true });
    await writeFile(path.join(sourceDir, 'same.bin'), 'same');
    await writeFile(path.join(stagingDir, 'same.bin'), 'same');
    await writeFile(path.join(sourceDir, 'system', 'game.exe'), 'complete');
    await writeFile(path.join(stagingDir, 'system', 'game.exe'), '00000000');

    const plan = {
      sourceDir,
      registeredInstallDir,
      stagingDir,
      productId: '109'
    };
    const dryRun = await seedConnectDownload(plan, { dryRun: true });
    expect(dryRun).toMatchObject({
      totalFiles: 2,
      skippedMatchingFiles: 1,
      seededFiles: 1,
      seededBytes: 8
    });
    await expect(
      readFile(path.join(stagingDir, 'system', 'game.exe'), 'utf8')
    ).resolves.toBe('00000000');

    const result = await seedConnectDownload(plan);
    expect(result).toMatchObject({
      totalFiles: 2,
      skippedMatchingFiles: 1,
      seededFiles: 1,
      seededBytes: 8
    });
    await expect(
      readFile(path.join(stagingDir, 'system', 'game.exe'), 'utf8')
    ).resolves.toBe('complete');
  });

  it('waits for Connect to publish its manifest and remove product staging', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-seed-'));
    const registeredInstallDir = path.join(root, 'registered');
    const stagingDir = path.join(registeredInstallDir, 'uplay_download', '109');
    await mkdir(stagingDir, { recursive: true });
    setTimeout(() => {
      void Promise.all([
        rm(stagingDir, { recursive: true }),
        writeFile(
          path.join(registeredInstallDir, 'uplay_install.manifest'),
          'official'
        )
      ]);
    }, 20);

    await expect(
      waitForConnectFinalization(
        {
          sourceDir: path.join(root, 'source'),
          registeredInstallDir,
          stagingDir,
          productId: '109'
        },
        1_000
      )
    ).resolves.toBeUndefined();
  });

  it('rejects symlink files in Connect staging even when content matches', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-seed-'));
    const sourceDir = path.join(root, 'source');
    const registeredInstallDir = path.join(root, 'registered');
    const stagingDir = path.join(registeredInstallDir, 'uplay_download', '109');
    await mkdir(sourceDir);
    await mkdir(stagingDir, { recursive: true });
    await writeFile(path.join(sourceDir, 'game.bin'), 'matching');
    await writeFile(path.join(root, 'outside'), 'matching');
    await symlink(
      path.join(root, 'outside'),
      path.join(stagingDir, 'game.bin')
    );

    await expect(
      seedConnectDownload({
        sourceDir,
        registeredInstallDir,
        stagingDir,
        productId: '109'
      })
    ).rejects.toThrow(/symbolic-link file in Connect staging/);
  });

  it('rejects symlinks in the reconstructed source tree', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-connect-seed-'));
    const sourceDir = path.join(root, 'source');
    const registeredInstallDir = path.join(root, 'registered');
    const stagingDir = path.join(registeredInstallDir, 'uplay_download', '109');
    await mkdir(sourceDir);
    await mkdir(stagingDir, { recursive: true });
    await writeFile(path.join(root, 'outside'), 'test');
    await symlink(path.join(root, 'outside'), path.join(sourceDir, 'linked'));

    await expect(
      seedConnectDownload({
        sourceDir,
        registeredInstallDir,
        stagingDir,
        productId: '109'
      })
    ).rejects.toThrow(/source tree containing a symlink/);
  });
});
