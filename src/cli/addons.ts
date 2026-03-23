import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { AddonInfo } from '../models/addon';
import { AddonService } from '../services/addon-service';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import type { CliContext } from './context';

function renderHuman(items: AddonInfo[]): string {
  if (items.length === 0) {
    return 'No associated products found.';
  }

  return [
    'Product ID   Type      Manifest Count  Title',
    '----------   --------  --------------  -----',
    ...items.map(
      (item) =>
        `${String(item.productId).padEnd(10)}   ${String(item.productType ?? 'unknown').padEnd(8)}  ${String(item.manifestHashes.length).padEnd(14)}  ${item.title ?? '(unknown)'}`
    )
  ].join('\n');
}

function buildAddonService(context: CliContext): AddonService {
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

  return new AddonService(product, catalog);
}

export function registerAddonsCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('addons <titleOrId>')
    .description(
      'List associated Ubisoft products (for example DLC/add-ons) from the public product graph'
    )
    .option('--json', 'Output JSON')
    .option(
      '--limit <n>',
      'Limit the number of associated products shown',
      '20'
    )
    .action(
      async (
        titleOrId: string,
        options: { json?: boolean; limit?: string }
      ) => {
        const context = await makeContext();
        const addonsService = buildAddonService(context);
        const limit = Number.parseInt(options.limit ?? '20', 10);
        const items = (
          await addonsService.listAssociatedProducts(titleOrId)
        ).slice(0, Number.isNaN(limit) ? 20 : limit);

        if (options.json) {
          process.stdout.write(`${JSON.stringify(items, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${renderHuman(items)}\n`);
      }
    );
}
