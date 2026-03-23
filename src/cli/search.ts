import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { SearchResult } from '../models/search';
import { LibraryService } from '../services/library-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { SearchService } from '../services/search-service';
import type { CliContext } from './context';

function renderHuman(results: SearchResult[]): string {
  if (results.length === 0) {
    return 'No matches found.';
  }

  return [
    'Owned  Source   Product ID   Type      Title',
    '-----  -------  ----------   --------  -----',
    ...results.map(
      (result) =>
        `${String(result.owned).padEnd(5)}  ${result.source.padEnd(7)}  ${String(result.productId ?? 'unknown').padEnd(10)}   ${String(result.productType ?? 'unknown').padEnd(8)}  ${result.title}`
    )
  ].join('\n');
}

function buildSearchService(context: CliContext): SearchService {
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

  return new SearchService(library, catalog);
}

export function registerSearchCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('search <text>')
    .description(
      'Search owned library titles and public catalog titles to disambiguate product IDs and DLC-like associations'
    )
    .option('--json', 'Output JSON')
    .option('--limit <n>', 'Limit the number of matches shown', '25')
    .action(
      async (text: string, options: { json?: boolean; limit?: string }) => {
        const context = await makeContext();
        const searchService = buildSearchService(context);
        const limit = Number.parseInt(options.limit ?? '25', 10);
        const results = await searchService.search(
          text,
          Number.isNaN(limit) ? 25 : limit
        );

        if (options.json) {
          process.stdout.write(`${JSON.stringify(results, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${renderHuman(results)}\n`);
      }
    );
}
