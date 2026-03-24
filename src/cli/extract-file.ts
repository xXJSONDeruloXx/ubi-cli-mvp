import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type {
  DemuxExtractedFileResult,
  DemuxExtractedFilesResult
} from '../models/demux';
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

function renderBatchHuman(
  info: DemuxExtractedFilesResult,
  maxFiles = Number.POSITIVE_INFINITY
): string {
  const visibleFiles = info.files.slice(0, maxFiles);
  const omittedCount = info.files.length - visibleFiles.length;

  return [
    `title: ${info.title}`,
    `demuxProductId: ${info.demuxProductId}`,
    `publicProductId: ${info.publicProductId ?? 'unknown'}`,
    `manifestHash: ${info.manifestHash}`,
    `outputDir: ${info.outputDir}`,
    `matchedCount: ${info.matchedCount}`,
    `extractedCount: ${info.extractedCount}`,
    `sliceReferenceCount: ${info.sliceReferenceCount}`,
    `uniqueSliceCount: ${info.uniqueSliceCount}`,
    `bytesDownloaded: ${info.bytesDownloaded}`,
    `bytesWritten: ${info.bytesWritten}`,
    `files:`,
    ...visibleFiles.map(
      (file) =>
        `  - ${file.manifestPath} | slices=${file.sliceCount} | bytes=${file.bytesWritten} | path=${file.outputPath}`
    ),
    ...(omittedCount > 0 ? [`  ... ${omittedCount} more files omitted`] : []),
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

  program
    .command('extract-files <query> <pathFilter>')
    .description(
      'Experimentally reconstruct multiple live manifest files whose paths match a substring or prefix filter'
    )
    .option('--json', 'Output JSON')
    .option(
      '--prefix',
      'Treat <pathFilter> as a normalized manifest-path prefix'
    )
    .option('--limit <n>', 'Limit the number of matched files extracted', '10')
    .option(
      '--output-dir <path>',
      'Override the root output directory for extracted files'
    )
    .action(
      async (
        query: string,
        pathFilter: string,
        options: {
          json?: boolean;
          prefix?: boolean;
          limit?: string;
          outputDir?: string;
        }
      ) => {
        const context = await makeContext();
        const demuxService = buildDemuxService(context);
        try {
          const limit = Number.parseInt(options.limit ?? '10', 10);
          const info = await demuxService.extractFiles(query, pathFilter, {
            prefixMatch: options.prefix,
            limit: Number.isNaN(limit) ? 10 : limit,
            outputDir: options.outputDir
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderBatchHuman(info)}\n`);
        } finally {
          await demuxService.destroy();
        }
      }
    );

  program
    .command('download-game <query>')
    .description(
      'Experimentally reconstruct the full live manifest file set for an owned game into a local directory tree'
    )
    .option('--json', 'Output JSON')
    .option(
      '--output-dir <path>',
      'Override the root output directory for the reconstructed game tree'
    )
    .option(
      '--workers <n>',
      'Number of manifest files to reconstruct concurrently',
      '4'
    )
    .action(
      async (
        query: string,
        options: { json?: boolean; outputDir?: string; workers?: string }
      ) => {
        const context = await makeContext();
        const demuxService = buildDemuxService(context);
        try {
          const workerCount = Number.parseInt(options.workers ?? '4', 10);
          const info = await demuxService.downloadGame(query, {
            outputDir: options.outputDir,
            workerCount: Number.isNaN(workerCount) ? 4 : workerCount
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderBatchHuman(info, 10)}\n`);
        } finally {
          await demuxService.destroy();
        }
      }
    );
}
