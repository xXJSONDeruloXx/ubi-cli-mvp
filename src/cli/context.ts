import { ensureAppDirs, getAppPaths, loadRuntimeConfig } from '../core/config';
import { createLogger, type LogLevel, type Logger } from '../util/logger';
import type { AppPaths, RuntimeConfig } from '../models/config';

export interface CliContext {
  logger: Logger;
  paths: AppPaths;
  config: RuntimeConfig;
}

export interface GlobalCliOptions {
  verbose?: boolean;
  quiet?: boolean;
}

export async function createCliContext(
  options: GlobalCliOptions
): Promise<CliContext> {
  const level: LogLevel = options.quiet
    ? 'silent'
    : options.verbose
      ? 'debug'
      : 'info';
  const logger = createLogger(level, 'ubi');
  const paths = getAppPaths();
  await ensureAppDirs(paths);
  const config = await loadRuntimeConfig(paths);

  return {
    logger,
    paths,
    config
  };
}
