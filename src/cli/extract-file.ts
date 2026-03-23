import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { DemuxExtractedFileResult } from '../models/demux';
import { DemuxService } from '../services/demux-service';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import type { CliContext } from './context';

function renderHuman(info: DemuxExtractedFileResult): string {
  return [
    `title: ${info.title}`,
    `demuxProductId: ${info.demuxProductId}`,
    `publicProductId: ${info.publicProductId ?? 'unknown'}`,
    `manifestHash: ${info.manifestHash}`,
    `manifestPath: ${info.manifestPath}`,
    `outputPath: ${info.outputPath}`,
    `sliceCount: ${info.sliceCount}`,
    `bytesDownloaded: ${info.bytesDownloaded}`,
    `bytesWritten: ${info.bytesWritten}`,
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

export function registerExtractFileCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('extract-file <query> <manifestPath>')
    .description(
      'Experimentally reconstruct one manifest file for the current owned build by downloading and stitching its live slices into a local output path'
    )
    .option('--json', 'Output JSON')
    .option('--output <path>', 'Override the extracted file output path')
    .action(
      async (
        query: string,
        manifestPath: string,
        options: { json?: boolean; output?: string }
      ) => {
        const context = await makeContext();
        const demuxService = buildDemuxService(context);
        try {
          const info = await demuxService.extractFile(
            query,
            manifestPath,
            options.output
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
