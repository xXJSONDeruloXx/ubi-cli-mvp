import { open, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import prompts from 'prompts';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { loadSession } from '../core/session-store';
import {
  loadConnectProfiles,
  updateConnectProfiles
} from '../services/connect-profiles';
import {
  inspectConnectSetup,
  type ConnectSetupInspection
} from '../services/connect-setup';
import {
  buildWineProcessSpec,
  findUbisoftConnectExecutable,
  getVerifiedUbisoftConnectInstaller,
  installUbisoftConnect,
  prepareWinePrefix,
  runProcess,
  trustUbisoftConnectInstallation
} from '../services/ubisoft-connect';
import { UserFacingError } from '../util/errors';
import { performCliLogin } from './auth';
import type { CliContext } from './context';

const PROFILE_STORE_NAME = 'connect-profiles.json';

interface SetupOptions {
  winePrefix?: string;
  runner: string;
  runnerArg: string[];
  connectInstaller?: string;
  email?: string;
  passwordStdin?: boolean;
  launchConnect: boolean;
  allowConnectLaunch?: boolean;
  trustExistingConnect?: boolean;
  yes?: boolean;
  check?: boolean;
  strict?: boolean;
  json?: boolean;
}

type SetupStatus =
  | 'locally-ready'
  | 'needs-cli-login'
  | 'needs-connect-install'
  | 'needs-connect-trust'
  | 'needs-default-prefix'
  | 'needs-connect-auth'
  | 'partial-connect-auth'
  | 'unsafe-prefix';

interface SetupReport extends ConnectSetupInspection {
  setupStatus: SetupStatus;
  cliSession: 'missing' | 'present' | 'valid';
  defaultWinePrefix?: string;
  defaultPrefixConfigured: boolean;
  rememberedAuthValidity: 'offline-evidence-only';
  connectStarted: boolean;
  nextAction?: string;
}

async function acquireSetupLock(
  context: CliContext
): Promise<() => Promise<void>> {
  const lockPath = path.join(context.paths.dataDir, '.setup.lock');
  let handle;
  try {
    handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${process.pid}\n`);
  } catch (error) {
    if (handle) {
      await handle.close().catch(() => undefined);
      await rm(lockPath, { force: true });
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UserFacingError(
        `Another setup process may be running. If it crashed, verify no ubi process remains before removing ${lockPath}.`
      );
    }
    throw error;
  }
  return async () => {
    try {
      await handle.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  };
}

function collectRunnerArgument(value: string, previous: string[]): string[] {
  return [...previous, value];
}

function profileStorePath(context: CliContext): string {
  return path.join(context.paths.dataDir, PROFILE_STORE_NAME);
}

function defaultWinePrefix(context: CliContext): string {
  return path.join(context.paths.dataDir, 'wine-prefixes', 'ubisoft-connect');
}

function setupStatus(
  inspection: ConnectSetupInspection,
  cliSession: SetupReport['cliSession'],
  defaultPrefixConfigured: boolean
): Pick<SetupReport, 'setupStatus' | 'nextAction'> {
  if (
    !inspection.pathSafe ||
    (inspection.prefixExists &&
      (!inspection.prefixSafe ||
        (!inspection.prefixEmpty &&
          !inspection.prefixRecognizable &&
          !inspection.clientTrusted)))
  ) {
    return {
      setupStatus: 'unsafe-prefix',
      nextAction:
        'Select a real user-owned owner-only Wine prefix without symlink aliases.'
    };
  }
  if (cliSession === 'missing') {
    return {
      setupStatus: 'needs-cli-login',
      nextAction: 'Run `ubi setup` or `ubi login` to create the CLI session.'
    };
  }
  if (!inspection.clientInstalled) {
    return {
      setupStatus: 'needs-connect-install',
      nextAction: 'Run `ubi setup --yes` to install the pinned official client.'
    };
  }
  if (!inspection.clientTrusted) {
    return {
      setupStatus: 'needs-connect-trust',
      nextAction:
        'Reinstall through setup or explicitly run `ubi setup --trust-existing-connect` for this safe existing client.'
    };
  }
  if (!defaultPrefixConfigured) {
    return {
      setupStatus: 'needs-default-prefix',
      nextAction: 'Run `ubi setup` to save this client as the shared default.'
    };
  }
  if (inspection.rememberedAuth === 'partial') {
    return {
      setupStatus: 'partial-connect-auth',
      nextAction:
        'Open the official client and complete sign-in, then rerun `ubi setup --check`.'
    };
  }
  if (inspection.rememberedAuth === 'absent') {
    return {
      setupStatus: 'needs-connect-auth',
      nextAction:
        'Open the official client and complete sign-in, then rerun `ubi setup --check`.'
    };
  }
  return { setupStatus: 'locally-ready' };
}

async function buildSetupReport(
  winePrefix: string,
  cliSession: SetupReport['cliSession'],
  defaultWinePrefixValue: string | undefined,
  connectStarted: boolean
): Promise<SetupReport> {
  const inspection = await inspectConnectSetup(winePrefix);
  const defaultPrefixConfigured =
    defaultWinePrefixValue === inspection.winePrefix;
  return {
    ...inspection,
    ...setupStatus(inspection, cliSession, defaultPrefixConfigured),
    cliSession,
    ...(defaultWinePrefixValue
      ? { defaultWinePrefix: defaultWinePrefixValue }
      : {}),
    defaultPrefixConfigured,
    rememberedAuthValidity: 'offline-evidence-only',
    connectStarted
  };
}

async function confirmConnectInstall(
  assumeYes?: boolean,
  nonInteractive?: boolean
): Promise<void> {
  if (assumeYes) {
    return;
  }
  if (nonInteractive || !process.stdin.isTTY || !process.stdout.isTTY) {
    throw new UserFacingError(
      'Ubisoft Connect is not installed. Re-run `ubi setup --yes` to explicitly allow the pinned official client download and installation.'
    );
  }
  const answer = (await prompts({
    type: 'confirm',
    name: 'install',
    message:
      'Download and install the pinned official Ubisoft Connect client into this prefix?',
    initial: false
  })) as { install?: boolean };
  if (!answer.install) {
    throw new UserFacingError(
      'Setup stopped before Ubisoft Connect installation.'
    );
  }
}

function emitSetupProgress(message: string, asJson?: boolean): void {
  (asJson ? process.stderr : process.stdout).write(`${message}\n`);
}

function emitSetupReport(report: SetupReport, asJson?: boolean): void {
  if (asJson) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return;
  }

  process.stdout.write(
    [
      `setupStatus: ${report.setupStatus}`,
      `cliSession: ${report.cliSession}`,
      `defaultWinePrefix: ${report.defaultWinePrefix ?? '(not configured)'}`,
      `winePrefix: ${report.winePrefix}`,
      `prefix: ${!report.pathSafe ? 'unsafe-path' : report.prefixExists ? (report.prefixSafe ? 'present-safe' : 'present-needs-permission-hardening') : 'missing-safe-path'}`,
      `connectClient: ${report.clientInstalled ? 'installed' : 'missing'}`,
      `connectClientTrust: ${report.clientProvenance ?? 'untrusted'}`,
      `rememberedConnectAuth: ${report.rememberedAuth}`,
      'rememberedAuthValidity: offline-evidence-only',
      `connectStarted: ${report.connectStarted}`,
      ...(report.nextAction ? [`nextAction: ${report.nextAction}`] : [])
    ].join('\n') + '\n'
  );
}

export function registerSetupCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('setup')
    .description(
      'Configure CLI authentication and one shared official Connect Wine prefix'
    )
    .option(
      '--wine-prefix <directory>',
      'Shared Connect prefix (defaults to the configured prefix or app data)'
    )
    .option('--runner <command>', 'Wine-compatible runner command', 'wine')
    .option(
      '--runner-arg <argument>',
      'Argument placed before Wine executables; repeat when needed',
      collectRunnerArgument,
      []
    )
    .option(
      '--connect-installer <file>',
      'Use a local installer matching the pinned official SHA-256'
    )
    .option(
      '--email <email>',
      'Ubisoft account email for a missing CLI session'
    )
    .option(
      '--password-stdin',
      'Read the Ubisoft password from stdin when the CLI session is missing'
    )
    .option(
      '--no-launch-connect',
      'Do not open the official client when remembered desktop auth is absent'
    )
    .option(
      '--allow-connect-launch',
      'Explicitly allow opening Connect from JSON or noninteractive setup'
    )
    .option(
      '--trust-existing-connect',
      'Explicitly trust a safe existing client not installed by this setup command'
    )
    .option(
      '--yes',
      'Allow downloading and installing the pinned official Connect client'
    )
    .option(
      '--check',
      'Inspect setup and remembered-auth evidence without launching Connect or changing configuration'
    )
    .option(
      '--strict',
      'With --check, exit with status 2 unless setupStatus is locally-ready'
    )
    .option('--json', 'Output JSON')
    .action(async (options: SetupOptions) => {
      if (options.strict && !options.check) {
        throw new UserFacingError('--strict requires --check.');
      }
      const context = await makeContext();
      const storePath = profileStorePath(context);
      const store = await loadConnectProfiles(storePath);
      const winePrefix = path.resolve(
        options.winePrefix ??
          store.defaultWinePrefix ??
          defaultWinePrefix(context)
      );

      const preflight = await inspectConnectSetup(winePrefix);
      if (
        !options.check &&
        (!preflight.pathSafe ||
          (preflight.prefixExists &&
            (!preflight.prefixSafe ||
              (!preflight.prefixEmpty &&
                !preflight.prefixRecognizable &&
                !preflight.clientTrusted))))
      ) {
        throw new UserFacingError(
          `Refusing unsafe, non-owner-only, or unrecognized Wine prefix before authentication: ${winePrefix}`
        );
      }

      if (options.check) {
        const report = await buildSetupReport(
          winePrefix,
          (await loadSession(context.paths)) ? 'present' : 'missing',
          store.defaultWinePrefix,
          false
        );
        emitSetupReport(report, options.json);
        if (options.strict && report.setupStatus !== 'locally-ready') {
          process.exitCode = 2;
        }
        return;
      }

      const releaseSetupLock = await acquireSetupLock(context);
      try {
        const auth = new AuthService(
          context.paths,
          context.config,
          context.logger.child('auth')
        );
        const existingSession = await auth.getStoredSession();
        if (existingSession) {
          await auth.ensureValidSession();
        } else {
          const session = await performCliLogin(context, {
            email: options.email,
            passwordStdin: options.passwordStdin,
            nonInteractive:
              options.json || !process.stdin.isTTY || !process.stdout.isTTY
          });
          emitSetupProgress(
            `CLI login complete for ${session.nameOnPlatform ?? session.userId}.`,
            options.json
          );
        }

        const preparedPrefix = await prepareWinePrefix(winePrefix);
        let clientExecutable =
          await findUbisoftConnectExecutable(preparedPrefix);
        if (!clientExecutable) {
          await confirmConnectInstall(options.yes, options.json);
          emitSetupProgress(
            'Preparing the pinned official Ubisoft Connect installer...',
            options.json
          );
          const installer = await getVerifiedUbisoftConnectInstaller(
            context.paths.cacheDir,
            options.connectInstaller
          );
          clientExecutable = await installUbisoftConnect(
            options.runner,
            options.runnerArg,
            preparedPrefix,
            installer,
            options.json ? 'ignore' : 'inherit'
          );
          emitSetupProgress(
            'Official Ubisoft Connect client installed.',
            options.json
          );
        }

        if (
          options.trustExistingConnect &&
          !(await inspectConnectSetup(preparedPrefix)).clientTrusted
        ) {
          await trustUbisoftConnectInstallation(
            preparedPrefix,
            clientExecutable
          );
        }

        await updateConnectProfiles(storePath, (current) => {
          current.defaultWinePrefix = preparedPrefix;
        });

        let report = await buildSetupReport(
          preparedPrefix,
          'valid',
          preparedPrefix,
          false
        );
        const connectLaunchAllowed =
          options.launchConnect &&
          (options.allowConnectLaunch ||
            (!options.json && process.stdin.isTTY && process.stdout.isTTY));
        if (
          report.clientTrusted &&
          report.rememberedAuth !== 'present' &&
          connectLaunchAllowed
        ) {
          const spec = buildWineProcessSpec(
            options.runner,
            clientExecutable,
            preparedPrefix,
            options.runnerArg,
            { WINEDLLOVERRIDES: 'mscoree,mshtml=' }
          );
          spec.stdio = 'ignore';
          await runProcess(spec, 'Ubisoft Connect authentication');
          report = await buildSetupReport(
            preparedPrefix,
            'valid',
            preparedPrefix,
            true
          );
        }

        emitSetupReport(report, options.json);
        if (report.rememberedAuth !== 'present' && !options.json) {
          process.stdout.write(
            'Complete sign-in/MFA only in the official Connect window. `ubi setup --check` can then detect remembered state without launching the client.\n'
          );
        }
      } finally {
        await releaseSetupLock();
      }
    });
}
