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
import type { CliContext } from './context';

function renderHuman(item: DemuxOwnedGame): string {
  return [
    `title: ${item.title}`,
    `demuxProductId: ${item.demuxProductId}`,
    `publicProductId: ${item.publicProductId ?? 'unknown'}`,
    `spaceId: ${item.spaceId ?? 'unknown'}`,
    `appId: ${item.appId ?? 'unknown'}`,
    `state: ${item.state}`,
    `productType: ${item.productType}`,
    `latestManifest: ${item.latestManifest ?? '(none)'}`,
    `hasDownloadManifest: ${item.hasDownloadManifest}`,
    `config.rootName: ${item.configSummary?.rootName ?? '(unknown)'}`,
    `config.publisher: ${item.configSummary?.publisher ?? '(unknown)'}`,
    `config.gameCode: ${item.configSummary?.gameCode ?? '(unknown)'}`,
    `activeBranchId: ${item.activeBranchId ?? 'unknown'}`,
    `branches: ${item.branches.map((branch) => `${branch.branchName}:${branch.branchId}${branch.active ? '*' : ''}`).join(', ') || '(none)'}`,
    `productAssociations: ${item.productAssociations.join(', ') || '(none)'}`
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

export function registerDemuxInfoCommand(
  program: Command,
  makeContext: () => Promise<CliContext>
): void {
  program
    .command('demux-info <query>')
    .description(
      'Show Demux ownership metadata for an owned Ubisoft product using Demux/product/public-catalog reconciliation'
    )
    .option('--json', 'Output JSON')
    .action(async (query: string, options: { json?: boolean }) => {
      const context = await makeContext();
      const demuxService = buildDemuxService(context);
      try {
        const item = await demuxService.resolveOwnedGame(query);

        if (options.json) {
          process.stdout.write(`${JSON.stringify(item, null, 2)}\n`);
          return;
        }

        process.stdout.write(`${renderHuman(item)}\n`);
      } finally {
        await demuxService.destroy();
      }
    });
}
