import process from 'node:process';
import type { Command } from 'commander';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import type { ManifestInfo } from '../models/manifest';
import { LibraryService } from '../services/library-service';
import { ManifestService } from '../services/manifest-service';
import { ProductService } from '../services/product-service';
import { PublicCatalogService } from '../services/public-catalog-service';
import { DemuxService } from '../services/demux-service';
import type { CliContext } from './context';

function renderHuman(info: ManifestInfo): string {
  const parsedLanguages =
    info.parsedManifest && info.parsedManifest.languageCodes.length > 0
      ? info.parsedManifest.languageCodes.join(', ')
      : '(none)';
  const metadataLanguages =
    info.parsedMetadata && info.parsedMetadata.languageCodes.length > 0
      ? info.parsedMetadata.languageCodes.join(', ')
      : '(none)';
  const licenseLanguages =
    info.parsedLicenses && info.parsedLicenses.languageCodes.length > 0
      ? info.parsedLicenses.languageCodes.join(', ')
      : '(none)';
  const licenseIdentifiers =
    info.parsedLicenses && info.parsedLicenses.identifiers.length > 0
      ? info.parsedLicenses.identifiers.join(', ')
      : '(none)';

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
    `parsed.installBytes: ${info.parsedManifest?.installBytes ?? '(unknown)'}`,
    `parsed.downloadBytes: ${info.parsedManifest?.downloadBytes ?? '(unknown)'}`,
    `parsed.languages: ${parsedLanguages}`,
    `metadata.bytesOnDisk: ${info.parsedMetadata?.bytesOnDisk ?? '(unknown)'}`,
    `metadata.bytesToDownload: ${info.parsedMetadata?.bytesToDownload ?? '(unknown)'}`,
    `metadata.chunkCount: ${info.parsedMetadata?.chunkCount ?? '(unknown)'}`,
    `metadata.licenseCount: ${info.parsedMetadata?.licenseCount ?? '(unknown)'}`,
    `metadata.languages: ${metadataLanguages}`,
    `licenses.licenseCount: ${info.parsedLicenses?.licenseCount ?? '(unknown)'}`,
    `licenses.localeCount: ${info.parsedLicenses?.localeCount ?? '(unknown)'}`,
    `licenses.languages: ${licenseLanguages}`,
    `licenses.identifiers: ${licenseIdentifiers}`,
    `rawFixtureUrl: ${info.rawFixtureUrl ?? '(none)'}`,
    `rawSourceUrl: ${info.rawSourceUrl ?? '(none)'}`,
    `metadataUrl: ${info.metadataUrl ?? '(none)'}`,
    `licensesUrl: ${info.licensesUrl ?? '(none)'}`,
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
    .option(
      '--live',
      'Use live Demux/download-service retrieval instead of the public fixture path'
    )
    .option(
      '--with-assets',
      'When used with --live, also fetch and parse live .metadata and .licenses assets if the download service exposes them'
    )
    .action(
      async (
        titleOrId: string,
        options: { json?: boolean; live?: boolean; withAssets?: boolean }
      ) => {
        const context = await makeContext();
        const manifestService = buildManifestService(context);
        try {
          const info = options.live
            ? await manifestService.getLiveManifestInfo(titleOrId, {
                includeAssetDetails: options.withAssets
              })
            : await manifestService.getManifestInfo(titleOrId);

          if (options.json) {
            process.stdout.write(`${JSON.stringify(info, null, 2)}\n`);
            return;
          }

          process.stdout.write(`${renderHuman(info)}\n`);
        } finally {
          await manifestService.destroy();
        }
      }
    );
}
