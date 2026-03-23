import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { DownloadPlan } from '../models/manifest';
import { LibraryService } from '../services/library-service';
import { ManifestService } from '../services/manifest-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import type { CliContext } from './context';

function renderHuman(plan: DownloadPlan): string {
  return [
    `title: ${plan.title}`,
    `productId: ${plan.productId ?? 'unknown'}`,
    `status: ${plan.status}`,
    `manifest: ${plan.selectedManifestHash ?? '(none)'}`,
    `installBytes: ${plan.installBytes ?? '(unknown)'}`,
    `downloadBytes: ${plan.downloadBytes ?? '(unknown)'}`,
    `chunkCount: ${plan.chunkCount ?? '(unknown)'}`,
    `fileCount: ${plan.fileCount ?? '(unknown)'}`,
    `largestFiles:`,
    ...plan.largestFiles.map(
      (file) =>
        `  - ${file.path} | install=${file.installBytes} | download=${file.downloadBytes} | slices=${file.sliceCount}`
    ),
    `notes: ${plan.notes.join(' | ')}`
  ].join('\n');
}

function buildManifestService(context: CliContext): ManifestService {
  const httpClient = new HttpClient(
    context.config,
    context.logger.child('http')
  );
  const auth = new AuthService(
    context.paths,
    context.config,
    context.logger.child('auth'),
    httpClient
  );
  const catalog = new PublicCatalogService(
    context.paths,
    context.config,
    context.logger.child('catalog'),
    httpClient
  );
  const library = new LibraryService(
    context.paths,
    context.config,
    context.logger.child('library'),
    catalog,
    auth,
    httpClient
  );
  const product = new ProductService(library, catalog);
  const demux = new DemuxService(
    context.paths,
    context.config,
    context.logger.child('demux'),
    catalog,
    product,
    auth,
    new DemuxClient(context.config, context.logger.child('demux-client')),
    httpClient
  );

  return new ManifestService(
    context.paths,
    context.config,
    context.logger.child('manifest'),
    product,
    catalog,
    demux,
    httpClient
  );
}

export function registerDownloadPlanCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('download-plan <titleOrId>')
    .description(
      'Show a dry-run download/install plan from a public fixture or a live Demux manifest'
    )
    .option('--json', 'Output JSON')
    .option(
      '--live',
      'Use live Demux/download-service retrieval instead of the public fixture path'
    )
    .option(
      '--match <text>',
      'Filter the plan to files whose manifest paths match a normalized substring or prefix'
    )
    .option(
      '--prefix',
      'Treat --match as a normalized manifest-path prefix instead of a substring'
    )
    .action(
      async (
        titleOrId: string,
        options: {
          json?: boolean;
          live?: boolean;
          match?: string;
          prefix?: boolean;
        }
      ) => {
        const context = await makeContext();
        const manifestService = buildManifestService(context);
        try {
          const plan = options.live
            ? await manifestService.getLiveDownloadPlan(titleOrId, {
                match: options.match,
                prefixMatch: options.prefix
              })
            : await manifestService.getDownloadPlan(titleOrId, {
                match: options.match,
                prefixMatch: options.prefix
              });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderHuman(plan)}\n`);
        } finally {
          await manifestService.destroy();
        }
      }
    );
}
