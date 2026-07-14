import { lstat, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { Command } from 'commander';
import { ensureAppDirs, getAppPaths } from '../core/config';
import {
  loadConnectProfiles,
  resolveProfileWinePrefix,
  saveConnectProfiles,
  type ConnectGameProfile
} from '../services/connect-profiles';
import {
  buildWineProcessSpec,
  findUbisoftConnectExecutable,
  runProcess,
  stopUbisoftConnect,
  waitForWineProcessLifecycle
} from '../services/ubisoft-connect';
import { UserFacingError } from '../util/errors';
import { resolveManifestOutputPath } from '../util/manifest-paths';

function profileStorePath(): string {
  return path.join(getAppPaths().dataDir, 'connect-profiles.json');
}

function validateProductId(productId: string): void {
  if (!/^\d+$/.test(productId)) {
    throw new UserFacingError('Connect product ID must contain digits only.');
  }
}

async function validateExistingPrefix(prefix: string): Promise<string> {
  const resolved = path.resolve(prefix);
  const prefixStats = await lstat(resolved).catch(() => undefined);
  const currentUid = process.getuid?.();
  if (
    !prefixStats?.isDirectory() ||
    prefixStats.isSymbolicLink() ||
    (currentUid !== undefined && prefixStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      `Wine prefix must be an existing, user-owned real directory: ${resolved}`
    );
  }
  if (!(await findUbisoftConnectExecutable(resolved))) {
    throw new UserFacingError(
      `Ubisoft Connect is not installed in the selected prefix: ${resolved}`
    );
  }
  return resolved;
}

function collectRunnerArgument(value: string, previous: string[]): string[] {
  return [...previous, value];
}

export function registerConnectProfileCommands(program: Command): void {
  const profiles = program
    .command('connect-profile')
    .description(
      'Manage non-secret product/prefix mappings for concise Connect launches'
    );

  profiles
    .command('default <winePrefix>')
    .description('Set the shared default Connect Wine prefix')
    .action(async (winePrefix: string) => {
      const paths = getAppPaths();
      await ensureAppDirs(paths);
      const storePath = profileStorePath();
      const store = await loadConnectProfiles(storePath);
      store.defaultWinePrefix = await validateExistingPrefix(winePrefix);
      await saveConnectProfiles(storePath, store);
      process.stdout.write(`defaultWinePrefix: ${store.defaultWinePrefix}\n`);
    });

  profiles
    .command('set <productId>')
    .description('Save a non-secret game source/prefix profile')
    .requiredOption(
      '--install-dir <directory>',
      'Reconstructed source directory used for repair/seeding'
    )
    .option(
      '--wine-prefix <directory>',
      'Override the shared default prefix for this product'
    )
    .option(
      '--executable <relative-path>',
      'Optional executable path relative to --install-dir'
    )
    .action(
      async (
        productId: string,
        options: {
          installDir: string;
          winePrefix?: string;
          executable?: string;
        }
      ) => {
        validateProductId(productId);
        const installDir = path.resolve(options.installDir);
        const installStats = await lstat(installDir).catch(() => undefined);
        if (!installStats?.isDirectory() || installStats.isSymbolicLink()) {
          throw new UserFacingError(
            `Install directory must be an existing real directory: ${installDir}`
          );
        }
        if (options.executable) {
          const executable = resolveManifestOutputPath(
            installDir,
            options.executable
          );
          const executableStats = await stat(executable).catch(() => undefined);
          if (!executableStats?.isFile()) {
            throw new UserFacingError(
              `Profile executable does not exist: ${executable}`
            );
          }
        }

        const paths = getAppPaths();
        await ensureAppDirs(paths);
        const storePath = profileStorePath();
        const store = await loadConnectProfiles(storePath);
        const profile: ConnectGameProfile = {
          productId,
          installDir,
          ...(options.winePrefix
            ? {
                winePrefix: await validateExistingPrefix(options.winePrefix)
              }
            : {}),
          ...(options.executable ? { executable: options.executable } : {})
        };
        store.games[productId] = profile;
        await saveConnectProfiles(storePath, store);
        process.stdout.write(
          [
            `productId: ${productId}`,
            `installDir: ${profile.installDir}`,
            `winePrefix: ${profile.winePrefix ?? store.defaultWinePrefix ?? '(not configured)'}`,
            `executable: ${profile.executable ?? '(not configured)'}`
          ].join('\n') + '\n'
        );
      }
    );

  profiles
    .command('remove <productId>')
    .description('Remove one non-secret game profile')
    .action(async (productId: string) => {
      validateProductId(productId);
      const paths = getAppPaths();
      await ensureAppDirs(paths);
      const storePath = profileStorePath();
      const store = await loadConnectProfiles(storePath);
      if (!store.games[productId]) {
        throw new UserFacingError(
          `No Connect profile exists for product ${productId}.`
        );
      }
      delete store.games[productId];
      await saveConnectProfiles(storePath, store);
      process.stdout.write(`removedProductId: ${productId}\n`);
    });

  profiles
    .command('list')
    .description('List non-secret Connect game/prefix profiles')
    .option('--json', 'Output JSON')
    .action(async (options: { json?: boolean }) => {
      const store = await loadConnectProfiles(profileStorePath());
      if (options.json) {
        process.stdout.write(`${JSON.stringify(store, null, 2)}\n`);
        return;
      }
      process.stdout.write(
        `defaultWinePrefix: ${store.defaultWinePrefix ?? '(not configured)'}\n`
      );
      for (const profile of Object.values(store.games).sort(
        (a, b) => Number(a.productId) - Number(b.productId)
      )) {
        process.stdout.write(
          `${profile.productId}: ${profile.installDir} | prefix=${profile.winePrefix ?? '(default)'} | executable=${profile.executable ?? '(not configured)'}\n`
        );
      }
    });

  program
    .command('play <productId>')
    .description(
      'Launch a profiled installed product through the official uplay:// handler'
    )
    .option('--runner <command>', 'Wine-compatible runner command', 'wine')
    .option(
      '--runner-arg <argument>',
      'Argument placed before UbisoftConnect.exe; repeat when needed',
      collectRunnerArgument,
      []
    )
    .option('--dry-run', 'Print the resolved launch without starting Connect')
    .option(
      '--leave-connect-open',
      'Return immediately after launch instead of waiting for the game and stopping Connect afterward'
    )
    .action(
      async (
        productId: string,
        options: {
          runner: string;
          runnerArg: string[];
          dryRun?: boolean;
          leaveConnectOpen?: boolean;
        }
      ) => {
        validateProductId(productId);
        const store = await loadConnectProfiles(profileStorePath());
        const prefix = await validateExistingPrefix(
          resolveProfileWinePrefix(store, productId)
        );
        const profile = store.games[productId];
        if (!options.leaveConnectOpen && !profile.executable) {
          throw new UserFacingError(
            `Profile ${productId} needs --executable before play can monitor the game and close Connect. Use --leave-connect-open or update the profile.`
          );
        }
        const clientExecutable = await findUbisoftConnectExecutable(prefix);
        if (!clientExecutable) {
          throw new UserFacingError(
            'Ubisoft Connect executable disappeared from the profiled prefix.'
          );
        }
        const launchUri = `uplay://launch/${productId}/0`;
        const spec = buildWineProcessSpec(
          options.runner,
          clientExecutable,
          prefix,
          options.runnerArg,
          { WINEDLLOVERRIDES: 'mscoree,mshtml=' }
        );
        spec.args.push(launchUri);
        spec.stdio = 'ignore';

        if (options.dryRun) {
          process.stdout.write(
            [
              `productId: ${productId}`,
              `winePrefix: ${prefix}`,
              `command: ${[spec.command, ...spec.args].map((value) => JSON.stringify(value)).join(' ')}`
            ].join('\n') + '\n'
          );
          return;
        }

        await runProcess(spec, 'Ubisoft Connect game launch');
        process.stdout.write(`connectLaunchUri: ${launchUri}\n`);
        if (options.leaveConnectOpen) {
          return;
        }

        const imageName = path.win32.basename(
          profile.executable!.replaceAll('/', '\\')
        );
        process.stdout.write(`waitingForGame: ${imageName}\n`);
        await waitForWineProcessLifecycle(
          options.runner,
          options.runnerArg,
          prefix,
          imageName,
          { startTimeoutMs: 10 * 60_000 }
        );
        process.stdout.write(`gameExited: ${imageName}\n`);
        await stopUbisoftConnect(options.runner, options.runnerArg, prefix);
        process.stdout.write('connectStopped: true\n');
      }
    );
}
