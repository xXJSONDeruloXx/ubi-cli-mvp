import type { Command } from 'commander';
import type { CliContext } from './context';

export function registerConfigCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  const config = program
    .command('config')
    .description('Inspect local CLI configuration');

  config
    .command('show')
    .description('Show the resolved runtime configuration and local paths')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const context = await makeContext();
      const payload = {
        config: context.config,
        paths: context.paths
      };

      if (options.json) {
        process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
        return;
      }

      process.stdout.write(
        [
          `appName: ${context.config.appName}`,
          `servicesAppId: ${context.config.servicesAppId}`,
          `browserAppId: ${context.config.browserAppId}`,
          `genomeId: ${context.config.genomeId}`,
          `requestedPlatformType: ${context.config.requestedPlatformType}`,
          `httpTimeoutMs: ${context.config.httpTimeoutMs}`,
          `httpRetryCount: ${context.config.httpRetryCount}`,
          `configDir: ${context.paths.configDir}`,
          `cacheDir: ${context.paths.cacheDir}`,
          `dataDir: ${context.paths.dataDir}`,
          `debugDir: ${context.paths.debugDir}`
        ].join('\n') + '\n'
      );
    });
}
