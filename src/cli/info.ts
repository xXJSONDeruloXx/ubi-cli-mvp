import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { ProductInfo } from '../models/product';
import { LibraryService } from '../services/library-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import type { CliContext } from './context';

function renderHuman(info: ProductInfo): string {
  return [
    `title: ${info.title}`,
    `productId: ${info.productId ?? 'unknown'}`,
    `spaceId: ${info.spaceId ?? 'unknown'}`,
    `appId: ${info.appId ?? 'unknown'}`,
    `productType: ${info.productType ?? 'unknown'}`,
    `manifestHashes: ${info.manifestHashes.length > 0 ? info.manifestHashes.join(', ') : '(none)'}`,
    `config.rootName: ${info.configSummary?.rootName ?? '(unknown)'}`,
    `config.publisher: ${info.configSummary?.publisher ?? '(unknown)'}`,
    `config.gameCode: ${info.configSummary?.gameCode ?? '(unknown)'}`,
    `sources.library: ${info.sources.library}`,
    `sources.publicCatalog: ${info.sources.publicCatalog}`
  ].join('\n');
}

function buildServices(context: CliContext): ProductService {
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

  return new ProductService(library, catalog);
}

export function registerInfoCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('info <titleOrId>')
    .description(
      'Show normalized product metadata for a Ubisoft title or product ID'
    )
    .option('--json', 'Output JSON')
    .action(async (titleOrId: string, options: { json?: boolean }) => {
      const context = await makeContext();
      const productService = buildServices(context);
      const { info } = await productService.resolveProduct(titleOrId);

      if (options.json) {
        process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHuman(info)}\n`);
    });
}
