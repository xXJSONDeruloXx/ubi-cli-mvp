import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { ManifestInfo } from '../models/manifest';
import { LibraryService } from '../services/library-service';
import { ManifestService } from '../services/manifest-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import type { CliContext } from './context';

function renderHuman(info: ManifestInfo): string {
  return [
    `title: ${info.title}`,
    `productId: ${info.productId ?? 'unknown'}`,
    `status: ${info.status}`,
    `manifestHashes: ${info.manifestHashes.length > 0 ? info.manifestHashes.join(', ') : '(none)'}`,
    `selectedManifestHash: ${info.selectedManifestHash ?? '(none)'}`,
    `parsed.version: ${info.parsedManifest?.version ?? '(unknown)'}`,
    `parsed.compressionMethod: ${info.parsedManifest?.compressionMethod ?? '(unknown)'}`,
    `parsed.chunkCount: ${info.parsedManifest?.chunkCount ?? '(unknown)'}`,
    `parsed.fileCount: ${info.parsedManifest?.fileCount ?? '(unknown)'}`,
    `parsed.languages: ${info.parsedManifest?.languageCodes.join(', ') ?? '(unknown)'}`,
    `rawFixtureUrl: ${info.rawFixtureUrl ?? '(none)'}`,
    `notes: ${info.notes.join(' | ')}`
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

  return new ManifestService(
    context.paths,
    context.config,
    context.logger.child('manifest'),
    product,
    catalog,
    httpClient
  );
}

export function registerManifestCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('manifest <titleOrId>')
    .description(
      'Show manifest/build information for a Ubisoft title or product ID'
    )
    .option('--json', 'Output JSON')
    .action(async (titleOrId: string, options: { json?: boolean }) => {
      const context = await makeContext();
      const manifestService = buildManifestService(context);
      const info = await manifestService.getManifestInfo(titleOrId);

      if (options.json) {
        process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
        return;
      }

      process.stdout.write(`${renderHuman(info)}\n`);
    });
}
