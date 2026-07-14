import process from 'node:process';
import type { Command } from 'commander';
import { cloneConnectPrefix } from '../services/connect-prefix';
import { UserFacingError } from '../util/errors';

export function registerConnectPrefixCommands(program: Command): void {
  const prefix = program
    .command('connect-prefix')
    .description(
      'Manage explicit Connect Wine prefixes without exposing authentication data'
    );

  prefix
    .command('clone <sourcePrefix> <targetPrefix>')
    .description(
      'Clone a stopped Connect prefix, including its remembered authentication state'
    )
    .option('--runner <command>', 'Wine-compatible runner command', 'wine')
    .option(
      '--include-auth',
      'Explicitly acknowledge that the clone contains sensitive remembered client authentication'
    )
    .option('--yes', 'Confirm creation of the sensitive owner-only clone')
    .option(
      '--allow-full-copy',
      'Allow a full copy when filesystem reflinks are unavailable (potentially large)'
    )
    .action(
      async (
        sourcePrefix: string,
        targetPrefix: string,
        options: {
          runner: string;
          includeAuth?: boolean;
          yes?: boolean;
          allowFullCopy?: boolean;
        }
      ) => {
        if (!options.includeAuth || !options.yes) {
          throw new UserFacingError(
            'Refusing to clone remembered Connect authentication without explicit --include-auth --yes.'
          );
        }
        const result = await cloneConnectPrefix(sourcePrefix, targetPrefix, {
          runner: options.runner,
          reflinkOnly: !options.allowFullCopy
        });
        process.stdout.write(
          [
            `sourcePrefix: ${result.sourcePrefix}`,
            `targetPrefix: ${result.targetPrefix}`,
            'targetMode: 0700',
            `reflinkRequired: ${result.reflinkRequired}`,
            'sensitiveAuthCopied: true',
            'Treat this as a one-way migration: once the target starts, token rotation may invalidate the source. Retire or delete the source rather than using both.'
          ].join('\n') + '\n'
        );
      }
    );
}
