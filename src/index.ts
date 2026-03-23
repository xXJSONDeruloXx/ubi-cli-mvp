#!/usr/bin/env node
import 'dotenv/config';
import process from 'node:process';
import { Command } from 'commander';
import { registerAddonsCommand } from './cli/addons';
import { registerAuthCommands } from './cli/auth';
import { registerConfigCommand } from './cli/config-show';
import { createCliContext } from './cli/context';
import { registerDoctorCommand } from './cli/doctor';
import { registerDownloadPlanCommand } from './cli/download-plan';
import { registerDownloadSlicesCommand } from './cli/download-slices';
import { registerDownloadUrlsCommand } from './cli/download-urls';
import { registerDemuxInfoCommand } from './cli/demux-info';
import { registerDemuxListCommand } from './cli/demux-list';
import { registerExtractFileCommand } from './cli/extract-file';
import { registerFilesCommand } from './cli/files';
import { registerInfoCommand } from './cli/info';
import { registerListCommand } from './cli/list';
import { registerManifestCommand } from './cli/manifest';
import { registerSearchCommand } from './cli/search';
import { registerSliceUrlsCommand } from './cli/slice-urls';
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
  registerDemuxListCommand(program, makeContext);
  registerSearchCommand(program, makeContext);
  registerInfoCommand(program, makeContext);
  registerDemuxInfoCommand(program, makeContext);
  registerManifestCommand(program, makeContext);
  registerFilesCommand(program, makeContext);
  registerDownloadPlanCommand(program, makeContext);
  registerDownloadUrlsCommand(program, makeContext);
  registerSliceUrlsCommand(program, makeContext);
  registerDownloadSlicesCommand(program, makeContext);
  registerExtractFileCommand(program, makeContext);
  registerAddonsCommand(program, makeContext);
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
