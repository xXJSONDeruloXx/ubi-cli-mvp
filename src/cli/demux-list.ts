import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { DemuxOwnedGame } from '../models/demux';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import { normalizeForMatch } from '../util/matching';
import type { CliContext } from './context';

function renderHuman(items: DemuxOwnedGame[]): string {
  const titleWidth = Math.min(
    42,
    Math.max(...items.map((item) => item.title.length), 'Title'.length)
  );

  return [
    `${'Title'.padEnd(titleWidth)}  Demux ID   Public ID   Manifest  App ID`,
    `${'-'.repeat(titleWidth)}  --------   ---------   --------  ------------------------------------`,
    ...items.map(
      (item) =>
        `${item.title.padEnd(titleWidth)}  ${String(item.demuxProductId).padEnd(8)}   ${String(item.publicProductId ?? 'unknown').padEnd(9)}   ${String(item.hasDownloadManifest).padEnd(8)}  ${item.appId ?? 'unknown'}`
    )
  ].join('\n');
}

function filterItems(
  items: DemuxOwnedGame[],
  search?: string
): DemuxOwnedGame[] {
  if (!search) {
    return items;
  }

  const normalizedSearch = normalizeForMatch(search);
  return items.filter((item) => {
    if (
      String(item.demuxProductId) === search.trim() ||
      (item.publicProductId !== undefined &&
        String(item.publicProductId) === search.trim())
    ) {
      return true;
    }

    return (
      normalizeForMatch(item.title).includes(normalizedSearch) ||
      item.spaceId?.includes(search.trim()) ||
      item.appId?.includes(search.trim())
    );
  });
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

export function registerDemuxListCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('demux-list')
    .description(
      'List Demux-owned Ubisoft products directly from ownership_service'
    )
    .option('--json', 'Output JSON')
    .option(
      '--search <text>',
      'Filter by title, product ID, Space ID, or App ID'
    )
    .action(async (options: { json?: boolean; search?: string }) => {
      const context = await makeContext();
      const demuxService = buildDemuxService(context);
      try {
        const items = filterItems(
          await demuxService.listOwnedGames(),
          options.search
        );

        if (options.json) {
          process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${renderHuman(items)}\n`);
      } finally {
        await demuxService.destroy();
      }
    });
}
