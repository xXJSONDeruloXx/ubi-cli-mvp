import process from 'node:process';
import type { Command } from 'commander';
import {
  loadSession,
  redactSession,
  sessionExists
} from '../core/session-store';
import { configFileExists } from '../core/config';
import type { CliContext } from './context';

interface DoctorReport {
  appName: string;
  nodeVersion: string;
  platform: NodeJS.Platform;
  cwd: string;
  paths: CliContext['paths'];
  configFileExists: boolean;
  sessionFileExists: boolean;
  session: Record<string, unknown> | null;
}

function renderHuman(report: DoctorReport): string {
  return [
    `app: ${report.appName}`,
    `node: ${report.nodeVersion}`,
    `platform: ${report.platform}`,
    `cwd: ${report.cwd}`,
    `config dir: ${report.paths.configDir}`,
    `cache dir: ${report.paths.cacheDir}`,
    `data dir: ${report.paths.dataDir}`,
    `debug dir: ${report.paths.debugDir}`,
    `config file: ${report.configFileExists ? 'present' : 'missing'}`,
    `session file: ${report.sessionFileExists ? 'present' : 'missing'}`
  ].join('\n');
}

export function registerDoctorCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('doctor')
    .description('Verify local environment and resolved config/session paths')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const context = await makeContext();
      const [hasConfig, hasSession, session] = await Promise.all([
        configFileExists(context.paths),
        sessionExists(context.paths),
        loadSession(context.paths)
      ]);

      const report: DoctorReport = {
        appName: context.config.appName,
        nodeVersion: process.version,
        platform: process.platform,
        cwd: process.cwd(),
        paths: context.paths,
        configFileExists: hasConfig,
        sessionFileExists: hasSession,
        session: redactSession(session)
      };

      if (options.json) {
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHuman(report)}\n`);
    });
}
