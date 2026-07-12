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
import { UserFacingError } from '../util/errors';
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

function parseBoundedInteger(
  value: string | undefined,
  label: string,
  minimum: number,
  maximum: number
): number {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new UserFacingError(
      `${label} must be a whole number between ${minimum} and ${maximum}.`
    );
  }
  return parsed;
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
    `availableFileCount: ${info.availableFileCount ?? info.matchedCount}`,
    `matchedCount: ${info.matchedCount}`,
    `selectionTruncated: ${info.selectionTruncated ?? false}`,
    `plannedInstallBytes: ${info.plannedInstallBytes ?? info.bytesWritten}`,
    `dryRun: ${info.dryRun ?? false}`,
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
      'Safely reconstruct a bounded subset of an owned live manifest; --all --yes is required for a full game'
    )
    .option('--json', 'Output JSON')
    .option('--limit <n>', 'Maximum files to select without --all', '10')
    .option(
      '--max-install-bytes <n>',
      'Maximum selected install bytes (default: 1073741824 without --all)'
    )
    .option('--all', 'Select the full live manifest file set')
    .option('--yes', 'Acknowledge an unbounded --all game download')
    .option(
      '--dry-run',
      'Validate and show the bounded selection without writing files'
    )
    .option(
      '--restart',
      'Discard incompatible resume state for this output directory'
    )
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
        options: {
          json?: boolean;
          outputDir?: string;
          workers?: string;
          limit?: string;
          maxInstallBytes?: string;
          all?: boolean;
          yes?: boolean;
          dryRun?: boolean;
          restart?: boolean;
        }
      ) => {
        const context = await makeContext();
        const demuxService = buildDemuxService(context);
        const abortController = new AbortController();
        const abortDownload = () => {
          abortController.abort(
            new UserFacingError('Download cancelled by interrupt.', 130)
          );
        };
        process.once('SIGINT', abortDownload);
        process.once('SIGTERM', abortDownload);
        try {
          if (options.all && !options.yes) {
            throw new UserFacingError(
              'Refusing an unbounded game download without --all --yes.'
            );
          }

          const workerCount = parseBoundedInteger(
            options.workers ?? '4',
            '--workers',
            1,
            8
          );
          const fileLimit = parseBoundedInteger(
            options.limit ?? '10',
            '--limit',
            1,
            100_000
          );
          const maxInstallBytes = options.maxInstallBytes
            ? parseBoundedInteger(
                options.maxInstallBytes,
                '--max-install-bytes',
                1,
                Number.MAX_SAFE_INTEGER
              )
            : undefined;
          const info = await demuxService.downloadGame(query, {
            outputDir: options.outputDir,
            workerCount,
            fileLimit,
            maxInstallBytes,
            allowAll: options.all,
            dryRun: options.dryRun,
            restart: options.restart,
            signal: abortController.signal,
            onProgress: options.json
              ? undefined
              : (event) => {
                  if (event.phase === 'preflight') {
                    process.stderr.write(
                      `Preparing ${event.selectedFileCount} file(s) for download...\n`
                    );
                    return;
                  }
                  if (event.phase === 'resume-scan-complete') {
                    process.stderr.write(
                      `Resume scan: ${event.completedFileCount}/${event.selectedFileCount} file(s) verified in ${((event.elapsedMs ?? 0) / 1000).toFixed(1)}s.\n`
                    );
                    return;
                  }
                  if (event.phase === 'url-resolution') {
                    const completed = event.completedBatchCount ?? 0;
                    const total = event.totalBatchCount ?? 0;
                    if (
                      completed === 1 ||
                      completed === total ||
                      completed % 10 === 0
                    ) {
                      process.stderr.write(
                        `Signed URL resolution: ${completed}/${total} batch(es), ${event.uniqueSliceCount ?? 0} slice(s), ${((event.elapsedMs ?? 0) / 1000).toFixed(1)}s.\n`
                      );
                    }
                    return;
                  }
                  if (event.phase === 'file-complete') {
                    process.stderr.write(
                      `[${event.completedFileCount}/${event.selectedFileCount}] ${event.manifestPath ?? '(unknown)'}\n`
                    );
                  }
                }
          });

          if (options.json) {
            process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderBatchHuman(info, 10)}\n`);
        } finally {
          process.removeListener('SIGINT', abortDownload);
          process.removeListener('SIGTERM', abortDownload);
          await demuxService.destroy();
        }
      }
    );
}
