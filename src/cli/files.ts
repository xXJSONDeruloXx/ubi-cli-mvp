import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { ManifestFileEntry } from '../models/manifest';
import { LibraryService } from '../services/library-service';
import { ManifestService } from '../services/manifest-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import { manifestPathMatches } from '../util/manifest-paths';
import type { CliContext } from './context';

function filterManifestFiles(
  items: ManifestFileEntry[],
  match: string | undefined,
  prefixMatch = false
): ManifestFileEntry[] {
  if (!match) {
    return items;
  }

  return items.filter((item) =>
    manifestPathMatches(item.path, match, prefixMatch)
  );
}

function renderHuman(items: ManifestFileEntry[]): string {
  if (items.length === 0) {
    return 'No manifest file entries were available.';
  }

  return [
    'Install Bytes  Download Bytes  Slices  Path',
    '------------  --------------  ------  ----',
    ...items.map(
      (item) =>
        `${item.installBytes.padEnd(12)}  ${item.downloadBytes.padEnd(14)}  ${String(item.sliceCount).padEnd(6)}  ${item.path}`
    )
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

export function registerFilesCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('files <titleOrId>')
    .description(
      'List manifest file entries for a Ubisoft title using public fixtures or live Demux retrieval'
    )
    .option('--json', 'Output JSON')
    .option(
      '--live',
      'Use live Demux/download-service retrieval instead of the public fixture path'
    )
    .option('--limit <n>', 'Limit the number of files shown', '25')
    .option(
      '--match <text>',
      'Filter manifest file paths by normalized substring or prefix'
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
          limit?: string;
          match?: string;
          prefix?: boolean;
        }
      ) => {
        const context = await makeContext();
        const manifestService = buildManifestService(context);
        try {
          const limit = Number.parseInt(options.limit ?? '25', 10);
          const items = filterManifestFiles(
            options.live
              ? await manifestService.getLiveManifestFiles(titleOrId)
              : await manifestService.getManifestFiles(titleOrId),
            options.match,
            options.prefix
          ).slice(0, Number.isNaN(limit) ? 25 : limit);

          if (options.json) {
            process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderHuman(items)}\n`);
        } finally {
          await manifestService.destroy();
        }
      }
    );
}
