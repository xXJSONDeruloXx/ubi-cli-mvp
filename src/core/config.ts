import { mkdir, access, readFile, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import envPaths from 'env-paths';
import type { AppPaths, RuntimeConfig } from '../models/config';

export const DEFAULT_CONFIG: RuntimeConfig = {
  appName: 'ubi-cli-mvp',
  servicesAppId:
    process.env.UBI_APP_ID ?? '82b650c0-6cb3-40c0-9f41-25a53b62b206',
  browserAppId:
    process.env.UBI_BROWSER_APP_ID ?? '314d4fef-e568-454a-ae06-43e3bece12a6',
  genomeId: process.env.UBI_GENOME_ID ?? '42d07c95-9914-4450-8b38-267c4e462b21',
  requestedPlatformType: 'uplay',
  httpTimeoutMs: 15000,
  httpRetryCount: 2
};

export function getAppPaths(appName = DEFAULT_CONFIG.appName): AppPaths {
  const resolved = envPaths(appName, { suffix: '' });

  return {
    configDir: resolved.config,
    cacheDir: resolved.cache,
    dataDir: resolved.data,
    logDir: resolved.log,
    debugDir: path.join(resolved.data, 'debug'),
    sessionFile: path.join(resolved.data, 'session.json'),
    configFile: path.join(resolved.config, 'config.json')
  };
}

export async function ensureAppDirs(paths: AppPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.configDir, { recursive: true }),
    mkdir(paths.cacheDir, { recursive: true }),
    mkdir(paths.dataDir, { recursive: true }),
    mkdir(paths.logDir, { recursive: true }),
    mkdir(paths.debugDir, { recursive: true })
  ]);
}

export async function configFileExists(paths: AppPaths): Promise<boolean> {
  try {
    await access(paths.configFile, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadRuntimeConfig(
  paths: AppPaths
): Promise<RuntimeConfig> {
  if (!(await configFileExists(paths))) {
    return DEFAULT_CONFIG;
  }

  const raw = await readFile(paths.configFile, 'utf8');
  const parsed = JSON.parse(raw) as Partial<RuntimeConfig>;

  return {
    ...DEFAULT_CONFIG,
    ...parsed,
    requestedPlatformType: 'uplay'
  };
}

export async function writeRuntimeConfig(
  paths: AppPaths,
  config: RuntimeConfig
): Promise<void> {
  await ensureAppDirs(paths);
  await writeFile(paths.configFile, JSON.stringify(config, null, 2));
}
