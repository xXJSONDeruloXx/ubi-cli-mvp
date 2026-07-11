import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { DownloadStateStore } from '../src/services/download-state';
import type { AppPaths } from '../src/models/config';

async function makePaths(): Promise<AppPaths> {
  const root = await mkdtemp(path.join(tmpdir(), 'ubi-download-state-'));
  return {
    configDir: path.join(root, 'config'),
    cacheDir: path.join(root, 'cache'),
    dataDir: path.join(root, 'data'),
    logDir: path.join(root, 'log'),
    debugDir: path.join(root, 'debug'),
    sessionFile: path.join(root, 'data', 'session.json'),
    configFile: path.join(root, 'config', 'config.json')
  };
}

describe('download state', () => {
  it('resumes only an unchanged manifest-bound file with the recorded hash', async () => {
    const paths = await makePaths();
    const outputRoot = path.join(paths.dataDir, 'game');
    const outputPath = path.join(outputRoot, 'bin', 'game.exe');
    const context = {
      demuxProductId: 46,
      manifestHash: 'MANIFEST',
      manifestBody: Buffer.from('manifest-body'),
      outputRoot
    };
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'verified-file');

    const first = await DownloadStateStore.open(paths, context);
    await first.recordCompleted('bin\\game.exe', outputPath, 13);
    const resumed = await DownloadStateStore.open(paths, context);
    await expect(
      resumed.isComplete('bin\\game.exe', outputPath, 13)
    ).resolves.toBe(true);

    await writeFile(outputPath, 'corrupt-file!');
    await expect(
      resumed.isComplete('bin\\game.exe', outputPath, 13)
    ).resolves.toBe(false);
  });

  it('requires explicit restart when a manifest changes for an output root', async () => {
    const paths = await makePaths();
    const outputRoot = path.join(paths.dataDir, 'game');
    const first = await DownloadStateStore.open(paths, {
      demuxProductId: 46,
      manifestHash: 'FIRST',
      manifestBody: Buffer.from('first'),
      outputRoot
    });
    const outputPath = path.join(outputRoot, 'bin', 'game.exe');
    await mkdir(path.dirname(outputPath), { recursive: true });
    await writeFile(outputPath, 'verified-file');
    await first.recordCompleted('bin\\game.exe', outputPath, 13);

    const changed = {
      demuxProductId: 46,
      manifestHash: 'SECOND',
      manifestBody: Buffer.from('second'),
      outputRoot
    };
    await expect(DownloadStateStore.open(paths, changed)).rejects.toThrow(
      /--restart/
    );
    await expect(
      DownloadStateStore.open(paths, changed, { restart: true })
    ).resolves.toBeInstanceOf(DownloadStateStore);
  });
});
