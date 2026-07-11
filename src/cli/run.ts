import { spawn } from 'node:child_process';
import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Command } from 'commander';
import { UserFacingError } from '../util/errors';
import { resolveManifestOutputPath } from '../util/manifest-paths';

async function findExecutables(
  root: string,
  current = root
): Promise<string[]> {
  const directory = await opendir(current);
  const executables: string[] = [];

  for await (const entry of directory) {
    const entryPath = path.join(current, entry.name);
    if (entry.isDirectory()) {
      executables.push(...(await findExecutables(root, entryPath)));
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.exe')) {
      executables.push(path.relative(root, entryPath));
    }
  }

  return executables;
}

export async function resolveGameExecutable(
  installDir: string,
  requestedExecutable?: string
): Promise<string> {
  const root = path.resolve(installDir);
  const rootStats = await stat(root).catch(() => undefined);
  if (!rootStats?.isDirectory()) {
    throw new UserFacingError(`Install directory does not exist: ${root}`);
  }

  if (requestedExecutable) {
    const executable = resolveManifestOutputPath(root, requestedExecutable);
    const executableStats = await stat(executable).catch(() => undefined);
    if (!executableStats?.isFile()) {
      throw new UserFacingError(
        `Game executable does not exist: ${executable}`
      );
    }
    return executable;
  }

  const candidates = (await findExecutables(root)).sort((a, b) =>
    a.localeCompare(b)
  );
  if (candidates.length === 1) {
    return path.join(root, candidates[0]);
  }
  if (candidates.length === 0) {
    throw new UserFacingError(
      'No .exe file was found below the install directory. Use --executable for a supported runner target.'
    );
  }

  throw new UserFacingError(
    `Found ${candidates.length} executable candidates. Re-run with --executable <relative-path>, for example: ${candidates.slice(0, 5).join(', ')}`
  );
}

function defaultRunner(): string | undefined {
  return process.platform === 'win32' ? undefined : 'wine';
}

export function registerRunCommand(program: Command): void {
  program
    .command('run <installDir>')
    .description(
      'Launch a reconstructed Windows game through Wine (or directly on Windows)'
    )
    .option(
      '--executable <relative-path>',
      'Executable path relative to <installDir>'
    )
    .option(
      '--runner <command>',
      'Runner command (default: wine outside Windows)'
    )
    .option(
      '--dry-run',
      'Resolve and print the launch command without starting it'
    )
    .action(
      async (
        installDir: string,
        options: { executable?: string; runner?: string; dryRun?: boolean }
      ) => {
        const executable = await resolveGameExecutable(
          installDir,
          options.executable
        );
        const runner = options.runner ?? defaultRunner();
        const command = runner ?? executable;
        const args = runner ? [executable] : [];

        if (options.dryRun) {
          process.stdout.write(
            `command: ${[command, ...args].map((value) => JSON.stringify(value)).join(' ')}\n`
          );
          return;
        }

        await new Promise<void>((resolve, reject) => {
          const child = spawn(command, args, { stdio: 'inherit' });
          child.once('error', (error) => {
            reject(
              new UserFacingError(
                `Could not launch ${command}: ${error.message}. Use --runner to select another runner.`
              )
            );
          });
          child.once('exit', (code, signal) => {
            if (code === 0) {
              resolve();
              return;
            }
            reject(
              new UserFacingError(
                `Game process exited with ${signal ? `signal ${signal}` : `code ${code ?? 'unknown'}`}.`
              )
            );
          });
        });
      }
    );
}
