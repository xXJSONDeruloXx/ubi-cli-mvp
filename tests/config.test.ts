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
    delete process.env.UBI_APP_ID;
    delete process.env.UBI_BROWSER_APP_ID;
    delete process.env.UBI_GENOME_ID;

    const root = await mkdtemp(path.join(tmpdir(), 'ubi-cli-config-'));
    envPathState.config = path.join(root, 'config');
    envPathState.data = path.join(root, 'data');
    envPathState.cache = path.join(root, 'cache');
    envPathState.log = path.join(root, 'log');
    envPathState.temp = path.join(root, 'temp');

    vi.resetModules();
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

  it('ignores blank environment overrides and merges stored config with defaults', async () => {
    process.env.UBI_APP_ID = '   ';
    process.env.UBI_BROWSER_APP_ID = '';
    process.env.UBI_GENOME_ID = '  ';

    const {
      DEFAULT_CONFIG,
      ensureAppDirs,
      getAppPaths,
      loadRuntimeConfig,
      writeRuntimeConfig
    } = await import('../src/core/config');
    const paths = getAppPaths();
    await ensureAppDirs(paths);

    expect(DEFAULT_CONFIG.servicesAppId).toBe(
      'f68a4bb5-608a-4ff2-8123-be8ef797e0a6'
    );

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
