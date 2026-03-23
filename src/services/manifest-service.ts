import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type { ManifestInfo, ParsedManifestSummary } from '../models/manifest';
import type { Logger } from '../util/logger';
import { HttpClient } from '../core/http';
import { loadUbisoftDemuxModule } from '../core/ubisoft-demux-loader';
import type { ProductService } from './product-service';
import type { PublicCatalogService } from './public-catalog-service';

export class ManifestService {
  private readonly httpClient: HttpClient;

  public constructor(
    private readonly paths: AppPaths,
    config: RuntimeConfig,
    logger: Logger,
    private readonly productService: ProductService,
    private readonly publicCatalog: PublicCatalogService,
    httpClient?: HttpClient
  ) {
    this.httpClient =
      httpClient ?? new HttpClient(config, logger.child('manifest-http'));
  }

  public async getManifestInfo(query: string): Promise<ManifestInfo> {
    const resolved = await this.productService.resolveProduct(query);
    const manifestHashes = resolved.info.manifestHashes;

    if (!resolved.info.productId || manifestHashes.length === 0) {
      return {
        title: resolved.info.title,
        productId: resolved.info.productId,
        manifestHashes,
        status: 'blocked',
        notes: [
          'No manifest hashes were available from the public catalog mapping for this product.'
        ]
      };
    }

    const selectedManifestHash = manifestHashes[0];
    const rawFixtureUrl = this.publicCatalog.getPublicManifestFixtureUrl(
      resolved.info.productId,
      selectedManifestHash
    );
    const rawResponse = await this.httpClient.requestRaw(rawFixtureUrl, {
      retryCount: 0,
      timeoutMs: 20000
    });

    if (rawResponse.status !== 200) {
      return {
        title: resolved.info.title,
        productId: resolved.info.productId,
        manifestHashes,
        selectedManifestHash,
        rawFixtureUrl,
        status: 'hashes-only',
        notes: [
          'The public catalog exposed manifest hashes, but no public raw manifest fixture was available at the expected GitHub path.'
        ]
      };
    }

    const fixturePath = path.join(
      this.paths.debugDir,
      `${resolved.info.productId}_${selectedManifestHash}.manifest`
    );
    await writeFile(fixturePath, rawResponse.body);

    const parsedManifest = await this.parseManifest(
      Buffer.from(rawResponse.body),
      selectedManifestHash
    );

    return {
      title: resolved.info.title,
      productId: resolved.info.productId,
      manifestHashes,
      selectedManifestHash,
      parsedManifest,
      rawFixtureUrl,
      status: 'parsed-public-fixture',
      notes: [
        'Manifest data came from the public UplayManifests GitHub dataset, not a live Ubisoft download-service session.'
      ]
    };
  }

  private async parseManifest(
    manifestBytes: Buffer,
    manifestHash: string
  ): Promise<ParsedManifestSummary> {
    const { UbisoftFileParser } = await loadUbisoftDemuxModule();
    const parser = new UbisoftFileParser();
    const parsed = parser.parseDownloadManifest(manifestBytes);
    const languageCodes = (parsed.languages ?? [])
      .map((language) => language.code)
      .filter((value): value is string => Boolean(value));
    const chunkCount = parsed.chunks?.length ?? 0;
    const fileCount = (parsed.chunks ?? []).reduce(
      (sum, chunk) => sum + (chunk.files?.length ?? 0),
      0
    );

    return {
      manifestHash,
      version: parsed.version,
      compressionMethod: parsed.compressionMethod,
      isCompressed: parsed.isCompressed,
      patchRequired: parsed.patchRequired,
      languageCodes,
      chunkCount,
      fileCount
    };
  }
}
