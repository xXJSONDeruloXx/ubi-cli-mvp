import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { LibraryItem } from '../models/library';
import { LibraryService } from '../services/library-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { normalizeForMatch } from '../util/matching';
import type { CliContext } from './context';

function renderHuman(items: LibraryItem[]): string {
  const titleWidth = Math.min(
    42,
    Math.max(...items.map((item) => item.title.length), 'Title'.length)
  );

  const lines = [
    `${'Title'.padEnd(titleWidth)}  Product ID   Variants  Space ID`,
    `${'-'.repeat(titleWidth)}  ----------   --------  ------------------------------------`
  ];

  for (const item of items) {
    lines.push(
      `${item.title.padEnd(titleWidth)}  ${String(item.productId ?? 'unknown').padEnd(10)}   ${String(item.variantCount ?? 1).padEnd(8)}  ${item.spaceId}`
    );
  }

  return lines.join('\n');
}

function filterItems(items: LibraryItem[], search?: string): LibraryItem[] {
  if (!search) {
    return items;
  }

  const normalizedSearch = normalizeForMatch(search);
  return items.filter((item) => {
    if (
      item.productId !== undefined &&
      String(item.productId) === search.trim()
    ) {
      return true;
    }

    return normalizeForMatch(item.title).includes(normalizedSearch);
  });
}

export function registerListCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('list')
    .description(
      'List the authenticated Ubisoft library using the GraphQL library endpoint'
    )
    .option('--json', 'Output JSON')
    .option('--all', 'Show raw entries instead of the deduped summary view')
    .option('--search <text>', 'Filter by title or product ID')
    .action(
      async (options: { json?: boolean; all?: boolean; search?: string }) => {
        const context = await makeContext();
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
        const items = filterItems(
          await library.listOwnedGames({ dedupe: !options.all }),
          options.search
        );

        if (options.json) {
          process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${renderHuman(items)}\n`);
      }
    );
}
