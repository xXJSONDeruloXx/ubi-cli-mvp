import process from 'node:process';
import type { Command } from 'commander';
import {
  cloneConnectPrefix,
  migrateConnectAuthentication
} from '../services/connect-prefix';
import { UserFacingError } from '../util/errors';

function collectRunnerArgument(value: string, previous: string[]): string[] {
  return [...previous, value];
}

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
      '--runner-arg <argument>',
      'Argument placed before Wine subcommands; repeat when needed',
      collectRunnerArgument,
      []
    )
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
          runnerArg: string[];
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
          runnerArgs: options.runnerArg,
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

  prefix
    .command('migrate-auth <sourcePrefix> <targetPrefix>')
    .description(
      'One-way migrate official remembered Connect authentication into an existing stopped prefix'
    )
    .option('--runner <command>', 'Wine-compatible runner command', 'wine')
    .option(
      '--runner-arg <argument>',
      'Argument placed before Wine subcommands; repeat when needed',
      collectRunnerArgument,
      []
    )
    .option(
      '--include-auth',
      'Explicitly acknowledge copying sensitive official-client authentication state'
    )
    .option(
      '--yes',
      'Confirm replacement of target Connect AppData and Wine device identity'
    )
    .action(
      async (
        sourcePrefix: string,
        targetPrefix: string,
        options: {
          runner: string;
          runnerArg: string[];
          includeAuth?: boolean;
          yes?: boolean;
        }
      ) => {
        if (!options.includeAuth || !options.yes) {
          throw new UserFacingError(
            'Refusing to migrate remembered Connect authentication without explicit --include-auth --yes.'
          );
        }
        const result = await migrateConnectAuthentication(
          sourcePrefix,
          targetPrefix,
          {
            runner: options.runner,
            runnerArgs: options.runnerArg
          }
        );
        process.stdout.write(
          [
            `sourcePrefix: ${result.sourcePrefix}`,
            `targetPrefix: ${result.targetPrefix}`,
            `appDataMigrated: ${result.appDataMigrated}`,
            `machineGuidMigrated: ${result.machineGuidMigrated}`,
            'sensitiveAuthCopied: true',
            'sourceMustNotBeStarted: true',
            'This is a one-way migration. Starting the target can rotate authentication and invalidate the source; retire the source after validating the target.'
          ].join('\n') + '\n'
        );
      }
    );
}
