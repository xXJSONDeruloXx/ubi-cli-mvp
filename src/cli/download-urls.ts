import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { DemuxDownloadUrlsInfo } from '../models/demux';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import type { CliContext } from './context';

function renderHuman(info: DemuxDownloadUrlsInfo): string {
  return [
    `title: ${info.title}`,
    `demuxProductId: ${info.demuxProductId}`,
    `publicProductId: ${info.publicProductId ?? 'unknown'}`,
    `manifestHash: ${info.manifestHash}`,
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

export function registerDownloadUrlsCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('download-urls <query>')
    .description(
      'Request live signed manifest/metadata/licenses URLs from Demux download_service for an owned product'
    )
    .option('--json', 'Output JSON')
    .action(async (query: string, options: { json?: boolean }) => {
      const context = await makeContext();
      const demuxService = buildDemuxService(context);
      try {
        const info = await demuxService.getDownloadUrls(query);

        if (options.json) {
          process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${renderHuman(info)}\n`);
      } finally {
        await demuxService.destroy();
      }
    });
}
