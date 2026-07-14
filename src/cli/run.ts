import { opendir, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { setTimeout as delay } from 'node:timers/promises';
import type { Command } from 'commander';
import prompts from 'prompts';
import { ensureAppDirs, getAppPaths } from '../core/config';
import {
  buildWineProcessSpec,
  findUbisoftConnectExecutable,
  getVerifiedUbisoftConnectInstaller,
  installUbisoftConnect,
  prepareWinePrefix,
  runProcess,
  UBISOFT_CONNECT_INSTALLER_SHA256
} from '../services/ubisoft-connect';
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

function collectRunnerArgument(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface RunOptions {
  executable?: string;
  runner?: string;
  runnerArg: string[];
  winePrefix?: string;
  connect?: boolean;
  ensureConnect?: boolean;
  connectInstaller?: string;
  connectReady?: boolean;
  connectProductId?: string;
  yes?: boolean;
  dryRun?: boolean;
}

function validateConnectOptions(options: RunOptions, runner?: string): void {
  const useConnect = options.connect || options.ensureConnect;
  if (options.connectReady && !useConnect) {
    throw new UserFacingError(
      '--connect-ready requires --connect or --ensure-connect.'
    );
  }
  if (options.connectInstaller && !options.ensureConnect) {
    throw new UserFacingError('--connect-installer requires --ensure-connect.');
  }
  if (options.connectProductId && !useConnect) {
    throw new UserFacingError(
      '--connect-product-id requires --connect or --ensure-connect.'
    );
  }
  if (options.connectProductId && !/^\d+$/.test(options.connectProductId)) {
    throw new UserFacingError('--connect-product-id must contain digits only.');
  }
  if (!useConnect) {
    return;
  }
  if (!runner) {
    throw new UserFacingError(
      'Guided Ubisoft Connect startup currently requires a Wine-compatible --runner.'
    );
  }
  if (!options.winePrefix) {
    throw new UserFacingError(
      '--connect requires an explicit --wine-prefix so the CLI never modifies the default Wine prefix unexpectedly.'
    );
  }
}

function connectStartupDelayMs(): number {
  return process.env.NODE_ENV === 'test' ? 0 : 5_000;
}

async function promptForConnectAuthentication(): Promise<void> {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserFacingError(
      'Ubisoft Connect was started, but first authentication requires its official UI. If the game shows Download, initialize and pause that official download, fully exit Connect, then use connect-seed before launching.'
    );
  }

  process.stdout.write(
    [
      'Complete sign-in in the official Ubisoft Connect window.',
      'Continue only if Connect already recognizes the game and shows Play.',
      'If it shows Download, answer No. Start that official download once, pause and exit Connect, then run connect-seed.'
    ].join('\n') + '\n'
  );
  const answer = (await prompts({
    type: 'confirm',
    name: 'ready',
    message: 'Is Connect authenticated and showing the game as installed?',
    initial: false
  })) as { ready?: boolean };
  if (!answer.ready) {
    throw new UserFacingError(
      'Launch cancelled before desktop-client authentication and official installation were confirmed.'
    );
  }
}

function emitDryRun(
  executable: string,
  command: string,
  args: string[],
  prefix: string | undefined,
  connectExecutable: string | undefined,
  useConnect: boolean,
  connectProductId?: string
): void {
  process.stdout.write(
    `command: ${[command, ...args].map((value) => JSON.stringify(value)).join(' ')}\n`
  );
  process.stdout.write(`cwd: ${JSON.stringify(path.dirname(executable))}\n`);
  if (prefix) {
    process.stdout.write(`winePrefix: ${JSON.stringify(prefix)}\n`);
  }
  if (useConnect) {
    process.stdout.write(
      `ubisoftConnect: ${connectExecutable ? `installed (${JSON.stringify(connectExecutable)})` : 'not installed'}\n`
    );
    process.stdout.write(
      `installerSha256: ${UBISOFT_CONNECT_INSTALLER_SHA256}\n`
    );
    if (connectProductId) {
      process.stdout.write(
        `connectLaunchUri: ${JSON.stringify(`uplay://launch/${connectProductId}/0`)}\n`
      );
    }
  }
}

export function registerRunCommand(program: Command): void {
  program
    .command('run <installDir>')
    .description(
      'Launch a reconstructed Windows game, optionally with a guided Ubisoft Connect handoff'
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
      '--runner-arg <argument>',
      'Argument placed before the executable; repeat for runners such as Proton',
      collectRunnerArgument,
      []
    )
    .option(
      '--wine-prefix <directory>',
      'Explicit Wine prefix exported to child processes as WINEPREFIX'
    )
    .option(
      '--connect',
      'Start the official Ubisoft Connect client and pause for interactive authentication'
    )
    .option(
      '--ensure-connect',
      'Install the pinned official Ubisoft Connect build when missing; implies --connect'
    )
    .option(
      '--connect-installer <file>',
      'Use a local installer matching the pinned SHA-256 instead of downloading it'
    )
    .option(
      '--connect-ready',
      'Confirm that Connect authentication and installed-game discovery are already complete; skip the terminal prompt'
    )
    .option(
      '--connect-product-id <id>',
      'Launch a registered game through the official uplay:// protocol instead of starting its executable directly'
    )
    .option(
      '--yes',
      'Allow --ensure-connect to download and silently install the official client'
    )
    .option(
      '--dry-run',
      'Resolve and print the launch/client state without starting or installing anything'
    )
    .action(async (installDir: string, options: RunOptions) => {
      const executable = await resolveGameExecutable(
        installDir,
        options.executable
      );
      const runner = options.runner ?? defaultRunner();
      validateConnectOptions(options, runner);

      const prefix = options.winePrefix
        ? path.resolve(options.winePrefix)
        : undefined;
      const useConnect = Boolean(options.connect || options.ensureConnect);
      const command = runner ?? executable;
      const args = runner
        ? [...options.runnerArg, executable]
        : [...options.runnerArg];
      const connectExecutable = prefix
        ? await findUbisoftConnectExecutable(prefix)
        : undefined;

      if (options.dryRun) {
        emitDryRun(
          executable,
          command,
          args,
          prefix,
          connectExecutable,
          useConnect,
          options.connectProductId
        );
        return;
      }

      if (useConnect && !connectExecutable && !options.ensureConnect) {
        throw new UserFacingError(
          'Ubisoft Connect is not installed in this prefix. Re-run with --ensure-connect --yes to install the pinned official build.'
        );
      }
      if (
        useConnect &&
        !connectExecutable &&
        options.ensureConnect &&
        !options.yes
      ) {
        throw new UserFacingError(
          'Refusing to download or install Ubisoft Connect without explicit --ensure-connect --yes.'
        );
      }

      let resolvedPrefix = prefix;
      if (resolvedPrefix) {
        resolvedPrefix = await prepareWinePrefix(resolvedPrefix);
      }

      if (useConnect) {
        if (!runner || !resolvedPrefix) {
          throw new UserFacingError(
            'Internal error: Connect launch is missing its runner or prefix.'
          );
        }

        let clientExecutable = connectExecutable;
        if (!clientExecutable) {
          const paths = getAppPaths();
          await ensureAppDirs(paths);
          process.stdout.write(
            'Preparing the pinned official Ubisoft Connect installer...\n'
          );
          const installer = await getVerifiedUbisoftConnectInstaller(
            paths.cacheDir,
            options.connectInstaller
          );
          process.stdout.write(
            `Installer verified with SHA-256 ${UBISOFT_CONNECT_INSTALLER_SHA256}.\n`
          );
          clientExecutable = await installUbisoftConnect(
            runner,
            options.runnerArg,
            resolvedPrefix,
            installer
          );
        }

        if (!options.connectReady || !options.connectProductId) {
          process.stdout.write(
            'Starting the official Ubisoft Connect client...\n'
          );
          const connectSpec = buildWineProcessSpec(
            runner,
            clientExecutable,
            resolvedPrefix,
            options.runnerArg
          );
          // Connect leaves upc.exe running after its bootstrap process exits. Do not
          // let that background client retain this CLI's stdout/stderr descriptors.
          connectSpec.stdio = 'ignore';
          await runProcess(connectSpec, 'Ubisoft Connect');
        }

        if (!options.connectReady) {
          await promptForConnectAuthentication();
        } else if (!options.connectProductId) {
          // A newly started GUI client needs a moment to initialize its IPC API.
          await delay(connectStartupDelayMs());
        }

        if (options.connectProductId) {
          const launchUri = `uplay://launch/${options.connectProductId}/0`;
          process.stdout.write(
            `Launching registered Connect product ${options.connectProductId} through the official uplay:// protocol...\n`
          );
          const uriSpec = buildWineProcessSpec(
            runner,
            clientExecutable,
            resolvedPrefix,
            options.runnerArg
          );
          uriSpec.args.push(launchUri);
          uriSpec.stdio = 'ignore';
          await runProcess(uriSpec, 'Ubisoft Connect game launch');
          return;
        }
      }

      const gameSpec = runner
        ? buildWineProcessSpec(
            runner,
            executable,
            resolvedPrefix,
            options.runnerArg
          )
        : {
            command: executable,
            args,
            cwd: path.dirname(executable),
            env: process.env
          };
      await runProcess(gameSpec, 'Game process');
    });
}
