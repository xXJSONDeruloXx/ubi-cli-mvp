import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { LibraryItem } from '../models/library';
import { LibraryService } from '../services/library-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import type { CliContext } from './context';

function renderHuman(items: LibraryItem[]): string {
  return items
    .map(
      (item) =>
        `${item.title} | productId=${item.productId ?? 'unknown'} | spaceId=${item.spaceId}`
    )
    .join('\n');
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
    .action(async (options: { json?: boolean }) => {
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
      const items = await library.listOwnedGames();

      if (options.json) {
        process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHuman(items)}\n`);
    });
}
