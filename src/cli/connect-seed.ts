import path from 'node:path';
import process from 'node:process';
import type { Command } from 'commander';
import {
  discoverConnectSeedPlan,
  seedConnectDownload,
  waitForConnectFinalization
} from '../services/connect-seed';
import {
  buildWineProcessSpec,
  findUbisoftConnectExecutable,
  runProcess
} from '../services/ubisoft-connect';
import { UserFacingError } from '../util/errors';

interface ConnectSeedOptions {
  winePrefix: string;
  productId: string;
  runner: string;
  dryRun?: boolean;
  yes?: boolean;
  finalize?: boolean;
  launch?: boolean;
}

export function registerConnectSeedCommand(program: Command): void {
  program
    .command('connect-seed <installDir>')
    .description(
      'Seed a paused official Ubisoft Connect download from a reconstructed tree, then let Connect verify it'
    )
    .requiredOption(
      '--wine-prefix <directory>',
      'Explicit Wine prefix containing the official paused download'
    )
    .requiredOption(
      '--product-id <id>',
      'Numeric Ubisoft Connect product ID, for example 109'
    )
    .option('--runner <command>', 'Wine-compatible runner command', 'wine')
    .option(
      '--dry-run',
      'Hash-compare source and staging files without changing them'
    )
    .option(
      '--yes',
      'Acknowledge overwriting incomplete files only inside the official paused download staging directory'
    )
    .option(
      '--finalize',
      'Restart Connect after seeding and wait for its official verification/finalization'
    )
    .option(
      '--launch',
      'After successful finalization, launch the registered product through uplay://; implies --finalize'
    )
    .action(async (installDir: string, options: ConnectSeedOptions) => {
      if (!options.dryRun && !options.yes) {
        throw new UserFacingError(
          'Refusing to modify Connect staging without explicit --yes. Run --dry-run first.'
        );
      }
      if (options.dryRun && (options.finalize || options.launch)) {
        throw new UserFacingError(
          '--finalize and --launch cannot be combined with --dry-run.'
        );
      }
      if (options.launch) {
        options.finalize = true;
      }

      const winePrefix = path.resolve(options.winePrefix);
      const plan = await discoverConnectSeedPlan(
        installDir,
        winePrefix,
        options.productId,
        options.runner
      );
      process.stdout.write(
        [
          `sourceDir: ${plan.sourceDir}`,
          `registeredInstallDir: ${plan.registeredInstallDir}`,
          `stagingDir: ${plan.stagingDir}`,
          `productId: ${plan.productId}`,
          'Connect state/registry will not be modified; only staged payload files are compared and seeded.'
        ].join('\n') + '\n'
      );

      let lastReported = 0;
      const result = await seedConnectDownload(plan, {
        dryRun: options.dryRun,
        onProgress(completed, total) {
          if (completed === total || completed - lastReported >= 100) {
            lastReported = completed;
            process.stderr.write(
              `connect-seed progress: ${completed}/${total}\n`
            );
          }
        }
      });

      process.stdout.write(
        [
          `totalFiles: ${result.totalFiles}`,
          `skippedMatchingFiles: ${result.skippedMatchingFiles}`,
          `${options.dryRun ? 'wouldSeedFiles' : 'seededFiles'}: ${result.seededFiles}`,
          `${options.dryRun ? 'wouldSeedBytes' : 'seededBytes'}: ${result.seededBytes}`,
          options.dryRun
            ? 'dryRun: true'
            : options.finalize
              ? 'Seed complete; starting official Connect verification/finalization.'
              : 'Next: start Ubisoft Connect and Resume/Download so the official client verifies and finalizes its own install.'
        ].join('\n') + '\n'
      );

      if (options.finalize) {
        const clientExecutable = await findUbisoftConnectExecutable(winePrefix);
        if (!clientExecutable) {
          throw new UserFacingError(
            'Ubisoft Connect executable disappeared from the selected prefix.'
          );
        }
        const connectSpec = buildWineProcessSpec(
          options.runner,
          clientExecutable,
          winePrefix,
          [],
          { WINEDLLOVERRIDES: 'mscoree,mshtml=' }
        );
        connectSpec.stdio = 'ignore';
        await runProcess(connectSpec, 'Ubisoft Connect finalization');
        await waitForConnectFinalization(plan);
        process.stdout.write(
          'connectFinalized: true (official install manifest present; product staging removed)\n'
        );

        if (options.launch) {
          const launchUri = `uplay://launch/${options.productId}/0`;
          const launchSpec = buildWineProcessSpec(
            options.runner,
            clientExecutable,
            winePrefix,
            [],
            { WINEDLLOVERRIDES: 'mscoree,mshtml=' }
          );
          launchSpec.args.push(launchUri);
          launchSpec.stdio = 'ignore';
          await runProcess(launchSpec, 'Ubisoft Connect game launch');
          process.stdout.write(`connectLaunchUri: ${launchUri}\n`);
        }
      }
    });
}
