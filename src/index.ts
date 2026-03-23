#!/usr/bin/env node
import 'dotenv/config';
import process from 'node:process';
import { Command } from 'commander';
import { registerAuthCommands } from './cli/auth';
import { registerConfigCommand } from './cli/config-show';
import { createCliContext } from './cli/context';
import { registerDoctorCommand } from './cli/doctor';
import { registerInfoCommand } from './cli/info';
import { registerListCommand } from './cli/list';
import { registerManifestCommand } from './cli/manifest';
import { UserFacingError } from './util/errors';

async function main(): Promise<void> {
  const program = new Command();

  program
    .name('ubi')
    .description('Research-driven Ubisoft Connect / Uplay CLI MVP')
    .option('-v, --verbose', 'Enable verbose structured logs')
    .option('-q, --quiet', 'Suppress structured logs except command output')
    .showHelpAfterError();

  const makeContext = async () =>
    createCliContext(program.opts<{ verbose?: boolean; quiet?: boolean }>());

  registerAuthCommands(program, makeContext);
  registerListCommand(program, makeContext);
  registerInfoCommand(program, makeContext);
  registerManifestCommand(program, makeContext);
  registerDoctorCommand(program, makeContext);
  registerConfigCommand(program, makeContext);

  await program.parseAsync(process.argv);
}

void main().catch((error: unknown) => {
  if (error instanceof UserFacingError) {
    process.stderr.write(`${error.message}\n`);
    process.exit(error.exitCode);
  }

  const message =
    error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
