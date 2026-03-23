import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { DemuxSliceUrlsInfo } from '../models/demux';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import type { CliContext } from './context';

function renderHuman(info: DemuxSliceUrlsInfo): string {
  return [
    `title: ${info.title}`,
    `demuxProductId: ${info.demuxProductId}`,
    `publicProductId: ${info.publicProductId ?? 'unknown'}`,
    `manifestHash: ${info.manifestHash}`,
    `totalUniqueSliceCount: ${info.totalUniqueSliceCount}`,
    `requestedSliceCount: ${info.requestedSliceCount}`,
    `ownershipTokenExpiresAt: ${info.ownershipTokenExpiresAt ?? 'unknown'}`,
    `urls:`,
    ...info.urls.map(
      (entry) =>
        `  - ${entry.relativePath} | result=${entry.result} | urlCount=${entry.urls.length}${entry.urls[0] ? ` | first=${entry.urls[0]}` : ''}`
    ),
    `notes: ${info.notes.join(' | ')}`
  ].join('\n');
}

function buildDemuxService(context: CliContext): DemuxService {
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

  return new DemuxService(
    context.paths,
    context.config,
    context.logger.child('demux'),
    catalog,
    product,
    auth,
    new DemuxClient(context.config, context.logger.child('demux-client')),
    httpClient
  );
}

export function registerSliceUrlsCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('slice-urls <query>')
    .description(
      'Request live signed slice URLs for the current owned build by parsing a live manifest and asking Demux download_service for slice paths'
    )
    .option('--json', 'Output JSON')
    .option(
      '--limit <n>',
      'Limit the number of unique slice URLs requested',
      '20'
    )
    .action(
      async (query: string, options: { json?: boolean; limit?: string }) => {
        const context = await makeContext();
        const demuxService = buildDemuxService(context);
        try {
          const limit = Number.parseInt(options.limit ?? '20', 10);
          const info = await demuxService.getSliceUrls(
            query,
            Number.isNaN(limit) ? 20 : limit
          );

          if (options.json) {
            process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderHuman(info)}\n`);
        } finally {
          await demuxService.destroy();
        }
      }
    );
}
