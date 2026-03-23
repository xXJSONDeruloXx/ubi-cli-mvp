import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { DemuxSliceDownloadResult } from '../models/demux';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import type { CliContext } from './context';

function renderHuman(result: DemuxSliceDownloadResult): string {
  return [
    `title: ${result.title}`,
    `demuxProductId: ${result.demuxProductId}`,
    `publicProductId: ${result.publicProductId ?? 'unknown'}`,
    `manifestHash: ${result.manifestHash}`,
    `outputDir: ${result.outputDir}`,
    `downloadedCount: ${result.downloadedCount}`,
    `files:`,
    ...result.files.map(
      (file) =>
        `  - ${file.relativePath} | bytes=${file.bytes} | path=${file.filePath}`
    ),
    `notes: ${result.notes.join(' | ')}`
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

export function registerDownloadSlicesCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('download-slices <query>')
    .description(
      'Experimentally download raw slice payloads for the current owned build into a local directory (not reconstructed game files)'
    )
    .option('--json', 'Output JSON')
    .option('--limit <n>', 'Limit the number of unique slices downloaded', '5')
    .option(
      '--output-dir <path>',
      'Override the output directory for raw slice blobs'
    )
    .action(
      async (
        query: string,
        options: { json?: boolean; limit?: string; outputDir?: string }
      ) => {
        const context = await makeContext();
        const demuxService = buildDemuxService(context);
        try {
          const limit = Number.parseInt(options.limit ?? '5', 10);
          const result = await demuxService.downloadSlices(
            query,
            Number.isNaN(limit) ? 5 : limit,
            options.outputDir
          );

          if (options.json) {
            process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderHuman(result)}\n`);
        } finally {
          await demuxService.destroy();
        }
      }
    );
}
