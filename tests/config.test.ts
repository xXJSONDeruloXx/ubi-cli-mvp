import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const envPathState = {
  config: '',
  data: '',
  cache: '',
  log: '',
  temp: ''
};

vi.mock('env-paths', () => ({
  default: () => envPathState
}));

describe('core/config', () => {
  beforeEach(async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-cli-config-'));
    envPathState.config = path.join(root, 'config');
    envPathState.data = path.join(root, 'data');
    envPathState.cache = path.join(root, 'cache');
    envPathState.log = path.join(root, 'log');
    envPathState.temp = path.join(root, 'temp');
  });

  it('creates all expected app directories', async () => {
    const { ensureAppDirs, getAppPaths } = await import('../src/core/config');
    const paths = getAppPaths();

    await ensureAppDirs(paths);

    await expect(access(paths.configDir)).resolves.toBeUndefined();
    await expect(access(paths.cacheDir)).resolves.toBeUndefined();
    await expect(access(paths.dataDir)).resolves.toBeUndefined();
    await expect(access(paths.logDir)).resolves.toBeUndefined();
    await expect(access(paths.debugDir)).resolves.toBeUndefined();
    expect(paths.sessionFile.endsWith('session.json')).toBe(true);
    expect(paths.configFile.endsWith('config.json')).toBe(true);
  });

  it('merges stored config with defaults', async () => {
    const {
      ensureAppDirs,
      getAppPaths,
      loadRuntimeConfig,
      writeRuntimeConfig
    } = await import('../src/core/config');
    const paths = getAppPaths();
    await ensureAppDirs(paths);

    const stored = {
      appName: 'ubi-cli-mvp',
      servicesAppId: 'override-app-id',
      browserAppId: 'browser-app-id',
      genomeId: 'genome-id',
      requestedPlatformType: 'uplay' as const,
      httpTimeoutMs: 123,
      httpRetryCount: 7
    };

    await writeRuntimeConfig(paths, stored);

    await expect(loadRuntimeConfig(paths)).resolves.toMatchObject({
      servicesAppId: 'override-app-id',
      httpTimeoutMs: 123,
      httpRetryCount: 7,
      requestedPlatformType: 'uplay'
    });
  });
});
