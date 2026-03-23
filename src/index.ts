#!/usr/bin/env node
import { Command } from 'commander';
import { registerConfigCommand } from './cli/config-show';
import { createCliContext } from './cli/context';
import { registerDoctorCommand } from './cli/doctor';

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

  registerDoctorCommand(program, makeContext);
  registerConfigCommand(program, makeContext);

  await program.parseAsync(process.argv);
}

void main();
