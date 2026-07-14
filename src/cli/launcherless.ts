import path from 'node:path';
import process from 'node:process';
import { stat } from 'node:fs/promises';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import {
  buildWineProcessSpec,
  prepareWinePrefix,
  runProcess
} from '../services/ubisoft-connect';
import { DemuxService } from '../services/demux-service';
import {
  cleanupLauncherlessProfiles,
  deployLauncherlessShims,
  inspectLauncherlessPlan,
  restoreLauncherlessInstall,
  writeLauncherlessProfiles
} from '../services/launcherless';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { sanitizedChildEnvironment } from '../util/child-env';
import { UserFacingError } from '../util/errors';
import {
  legacyCompatibilityEnvironment,
  resolveGameExecutable,
  resolveUmuCommand
} from './run';
import type { CliContext } from './context';

function buildDemuxService(context: CliContext): DemuxService {
  const httpClient = new HttpClient(
    context.config,
    context.logger.child('launcherless-http')
  );
  const auth = new AuthService(
    context.paths,
    context.config,
    context.logger.child('launcherless-auth'),
    httpClient
  );
  const catalog = new PublicCatalogService(
    context.paths,
    context.config,
    context.logger.child('launcherless-catalog'),
    httpClient
  );
  const library = new LibraryService(
    context.paths,
    context.config,
    context.logger.child('launcherless-library'),
    catalog,
    auth,
    httpClient
  );
  return new DemuxService(
    context.paths,
    context.config,
    context.logger.child('launcherless-demux'),
    catalog,
    new ProductService(library, catalog),
    auth,
    new DemuxClient(
      context.config,
      context.logger.child('launcherless-client')
    ),
    httpClient
  );
}

function launcherlessWorkingDirectory(
  installDir: string,
  executable: string
): string {
  const executableDirectory = path.dirname(executable);
  return path.basename(executableDirectory).toLowerCase() === 'system'
    ? executableDirectory
    : path.resolve(installDir);
}

function parseCpuLimit(value: string | undefined): number {
  const parsed = Number.parseInt(value ?? '4', 10);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 64) {
    throw new UserFacingError(
      '--cpu-limit must be a whole number between 0 and 64.'
    );
  }
  return parsed;
}

function collectGameArgument(value: string, previous: string[]): string[] {
  return [...previous, value];
}

interface LauncherlessRunOptions {
  executable?: string;
  shimDir: string;
  winePrefix?: string;
  umuCommand?: string;
  proton?: string;
  cpuLimit?: string;
  gameArg: string[];
  legacyCompat?: boolean;
  yes?: boolean;
  dryRun?: boolean;
  keepShims?: boolean;
  allowLocalTicket?: boolean;
  json?: boolean;
}

function windowsInstallPath(installDir: string): string {
  return `Z:${path.resolve(installDir).replaceAll('/', '\\')}\\`;
}

export function launcherlessRegistryCommands(
  productId: number,
  installDir: string
): string[][] {
  const installPath = windowsInstallPath(installDir);
  const keys = [
    `HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs\\${productId}`,
    `HKLM\\SOFTWARE\\Wow6432Node\\Ubisoft\\Launcher\\Installs\\${productId}`,
    'HKLM\\SOFTWARE\\Ubisoft\\Launcher',
    'HKLM\\SOFTWARE\\Wow6432Node\\Ubisoft\\Launcher'
  ];
  return keys.map((key) => [
    'reg',
    'add',
    key,
    '/v',
    'InstallDir',
    '/t',
    'REG_SZ',
    '/d',
    installPath,
    '/f'
  ]);
}

async function configureLauncherlessRegistry(
  runner: string,
  prefix: string,
  protonPath: string | undefined,
  productId: number,
  installDir: string
): Promise<void> {
  const env = sanitizedChildEnvironment({
    WINEPREFIX: prefix,
    GAMEID: '0',
    STORE: 'none',
    ...(protonPath ? { PROTONPATH: protonPath } : {})
  });
  for (const args of launcherlessRegistryCommands(productId, installDir)) {
    await runProcess(
      { command: runner, args, cwd: installDir, env },
      'Launcherless registry setup'
    );
  }
}

export function registerLauncherlessCommands(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  const launcherless = program
    .command('launcherless')
    .description(
      'Run supported owned legacy games without Ubisoft Connect using an explicit replacement-loader bundle'
    );

  launcherless
    .command('run <query> <installDir>')
    .description(
      'Fetch a real owned-game ticket, deploy reversible compatibility shims, and launch in a dedicated UMU/Proton prefix'
    )
    .requiredOption(
      '--shim-dir <directory>',
      'External shim bundle containing uplay_r1/, orbit_r2/, and optional eax/ directories'
    )
    .option(
      '--executable <relative-path>',
      'Executable path relative to <installDir>; required when several executables exist'
    )
    .option(
      '--wine-prefix <directory>',
      'Dedicated launcherless prefix (default: app data launcherless-prefixes/<productId>)'
    )
    .option('--umu-command <command>', 'Explicit umu-run executable')
    .option(
      '--proton <directory>',
      'Explicit Proton directory exported as PROTONPATH'
    )
    .option(
      '--no-legacy-compat',
      'Disable CPU-topology and NvAPI compatibility defaults'
    )
    .option(
      '--cpu-limit <n>',
      'Visible CPU count for legacy compatibility; 0 disables the topology cap',
      '4'
    )
    .option(
      '--game-arg <argument>',
      'Argument placed after the game executable; repeat for title-specific runtime flags',
      collectGameArgument,
      []
    )
    .option(
      '--keep-shims',
      'Leave replacement loader DLLs deployed after exit instead of restoring originals'
    )
    .option(
      '--allow-local-ticket',
      "Use the legacy shim's local ticket marker only after live Ubisoft ownership verification"
    )
    .option(
      '--dry-run',
      'Inspect ownership, executable, shim hashes, and paths without writing or launching'
    )
    .option('--json', 'Output the dry-run plan as JSON')
    .option(
      '--yes',
      'Confirm replacement-loader deployment and launcherless execution'
    )
    .action(
      async (
        query: string,
        installDir: string,
        options: LauncherlessRunOptions
      ) => {
        const context = await makeContext();
        const demux = buildDemuxService(context);
        try {
          const game = await demux.resolveOwnedGame(query);
          if (!game.owned) {
            throw new UserFacingError(
              `Product ${game.demuxProductId} is not owned by the authenticated account.`
            );
          }
          const executable = await resolveGameExecutable(
            installDir,
            options.executable
          );
          const plan = await inspectLauncherlessPlan(
            installDir,
            executable,
            options.shimDir
          );
          const prefix = path.resolve(
            options.winePrefix ??
              path.join(
                context.paths.dataDir,
                'launcherless-prefixes',
                String(game.demuxProductId)
              )
          );
          const summary = {
            title: game.title,
            demuxProductId: game.demuxProductId,
            uplayId: game.uplayId,
            owned: game.owned,
            installDir: plan.installDir,
            executable: plan.executable,
            drm: plan.drm,
            shimRoot: plan.shimRoot,
            winePrefix: prefix,
            gameArguments: options.gameArg,
            deployments: plan.deployments.map((deployment) => ({
              relativePath: deployment.relativePath,
              sha256: deployment.sha256
            })),
            restoresShimsAfterExit: !options.keepShims,
            usesSigningCertificate: false,
            storesPassword: false,
            ticketMode: game.uplayId
              ? 'ubisoft-issued-required'
              : options.allowLocalTicket
                ? 'local-owned-assertion'
                : 'unavailable-without---allow-local-ticket'
          };
          if (options.dryRun) {
            process.stdout.write(
              options.json
                ? `${JSON.stringify(summary, null, 2)}\n`
                : [
                    `title: ${summary.title}`,
                    `demuxProductId: ${summary.demuxProductId}`,
                    `uplayId: ${summary.uplayId ?? 'missing'}`,
                    `drm: ${summary.drm}`,
                    `executable: ${summary.executable}`,
                    `winePrefix: ${summary.winePrefix}`,
                    `gameArguments: ${summary.gameArguments.map((value) => JSON.stringify(value)).join(' ') || 'none'}`,
                    `deployments: ${summary.deployments.map((entry) => `${entry.relativePath} (${entry.sha256})`).join(' | ')}`,
                    'signingCertificate: disabled',
                    'passwordStorage: disabled',
                    `ticketMode: ${summary.ticketMode}`
                  ].join('\n') + '\n'
            );
            return;
          }
          if (!options.yes) {
            throw new UserFacingError(
              'Launcherless mode replaces folder-local Ubisoft loader DLLs and asserts owned/offline state to the game. Review --dry-run, then pass --yes to continue.'
            );
          }
          const account = await demux.resolveLauncherlessAccount(
            query,
            options.allowLocalTicket
          );
          await deployLauncherlessShims(plan);
          const workingDirectory = launcherlessWorkingDirectory(
            plan.installDir,
            plan.executable
          );
          await writeLauncherlessProfiles(plan, account, workingDirectory);
          try {
            const runner = await resolveUmuCommand(options.umuCommand);
            const resolvedPrefix = await prepareWinePrefix(prefix);
            let protonPath: string | undefined;
            if (options.proton) {
              protonPath = path.resolve(options.proton);
              const protonStats = await stat(protonPath).catch(() => undefined);
              if (!protonStats?.isDirectory()) {
                throw new UserFacingError(
                  `Proton directory does not exist: ${protonPath}`
                );
              }
            }
            await configureLauncherlessRegistry(
              runner,
              resolvedPrefix,
              protonPath,
              game.demuxProductId,
              plan.installDir
            );
            const cpuLimit = parseCpuLimit(options.cpuLimit);
            const spec = buildWineProcessSpec(
              runner,
              plan.executable,
              resolvedPrefix,
              [],
              {
                GAMEID: '0',
                STORE: 'none',
                ...(protonPath ? { PROTONPATH: protonPath } : {}),
                ...(options.legacyCompat === false
                  ? {}
                  : legacyCompatibilityEnvironment(cpuLimit))
              }
            );
            spec.args.push(...options.gameArg);
            spec.cwd = workingDirectory;
            spec.processGroup = true;
            process.stdout.write(
              `Launching owned product ${game.demuxProductId} without Ubisoft Connect (${plan.drm}, ${account.ticketSource})...\n`
            );
            await runProcess(spec, 'Launcherless game process');
          } finally {
            await cleanupLauncherlessProfiles(plan.installDir);
            if (!options.keepShims) {
              await restoreLauncherlessInstall(plan.installDir);
            }
          }
        } finally {
          await demux.destroy();
        }
      }
    );

  launcherless
    .command('restore <installDir>')
    .description(
      'Remove deployed launcherless shims and restore every backed-up original file after hash verification'
    )
    .action(async (installDir: string) => {
      const restored = await restoreLauncherlessInstall(installDir);
      process.stdout.write(
        `Restored ${restored} launcherless deployment(s).\n`
      );
    });
}
