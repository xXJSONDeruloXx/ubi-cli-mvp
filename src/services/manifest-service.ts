import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { HttpClient } from '../core/http';
import { loadUbisoftDemuxModule } from '../core/ubisoft-demux-loader';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type {
  DownloadPlan,
  ManifestFileEntry,
  ManifestInfo,
  ParsedLicensesSummary,
  ParsedManifestSummary,
  ParsedMetadataSummary
} from '../models/manifest';
import type { Logger } from '../util/logger';
import { manifestPathMatches } from '../util/manifest-paths';
import type { DemuxService } from './demux-service';
import type { ProductService } from './product-service';
import type { PublicCatalogService } from './public-catalog-service';

interface LoadedManifestSource {
  title: string;
  productId?: number;
  manifestHashes: string[];
  selectedManifestHash?: string;
  rawFixtureUrl?: string;
  rawSourceUrl?: string;
  metadataUrl?: string;
  licensesUrl?: string;
  status: ManifestInfo['status'];
  notes: string[];
  parsed?: unknown;
  parsedMetadata?: unknown;
  parsedLicenses?: unknown;
}

function toBigInt(value: unknown): bigint {
  if (typeof value === 'bigint') {
    return value;
  }

  if (typeof value === 'number') {
    return BigInt(value);
  }

  if (typeof value === 'string') {
    return BigInt(value);
  }

  if (typeof value === 'object' && value !== null) {
    const maybeStringifiable = value as { toString?: () => string };
    if (typeof maybeStringifiable.toString === 'function') {
      const rendered = maybeStringifiable.toString();
      if (/^\d+$/.test(rendered)) {
        return BigInt(rendered);
      }
    }
  }

  return 0n;
}

export function summarizeParsedManifest(
  parsed: {
    version?: number;
    compressionMethod?: number;
    isCompressed?: boolean;
    patchRequired?: boolean;
    languages?: Array<{ code?: string }>;
    chunks?: Array<{
      files?: Array<{
        size?: unknown;
        sliceList?: Array<{ downloadSize?: unknown }>;
      }>;
    }>;
  },
  manifestHash: string
): ParsedManifestSummary {
  const languageCodes = (parsed.languages ?? [])
    .map((language) => language.code)
    .filter((value): value is string => Boolean(value));
  const files = (parsed.chunks ?? []).flatMap((chunk) => chunk.files ?? []);
  const installBytes = files.reduce(
    (sum, file) => sum + toBigInt(file.size),
    0n
  );
  const downloadBytes = files.reduce(
    (sum, file) =>
      sum +
      (file.sliceList ?? []).reduce(
        (fileSum, slice) => fileSum + toBigInt(slice.downloadSize),
        0n
      ),
    0n
  );

  return {
    manifestHash,
    version: parsed.version,
    compressionMethod: parsed.compressionMethod,
    isCompressed: parsed.isCompressed,
    patchRequired: parsed.patchRequired,
    languageCodes,
    chunkCount: parsed.chunks?.length ?? 0,
    fileCount: files.length,
    installBytes: installBytes.toString(),
    downloadBytes: downloadBytes.toString()
  };
}

export function summarizeParsedMetadata(parsed: {
  bytesOnDisk?: unknown;
  bytesToDownload?: unknown;
  licenses?: Array<unknown>;
  chunks?: Array<unknown>;
  languages?: Array<{ code?: string }>;
  uplayIds?: number[];
}): ParsedMetadataSummary {
  return {
    bytesOnDisk: toBigInt(parsed.bytesOnDisk).toString(),
    bytesToDownload: toBigInt(parsed.bytesToDownload).toString(),
    chunkCount: parsed.chunks?.length ?? 0,
    licenseCount: parsed.licenses?.length ?? 0,
    languageCodes: (parsed.languages ?? [])
      .map((language) => language.code)
      .filter((value): value is string => Boolean(value)),
    uplayIds: [...new Set(parsed.uplayIds ?? [])].sort((a, b) => a - b)
  };
}

export function summarizeParsedLicenses(parsed: {
  licenses?: Array<{
    identifier?: string;
    locales?: Array<{ language?: string }>;
  }>;
}): ParsedLicensesSummary {
  const licenses = parsed.licenses ?? [];
  const languageCodes = [
    ...new Set(
      licenses.flatMap((license) =>
        (license.locales ?? [])
          .map((locale) => locale.language)
          .filter((value): value is string => Boolean(value))
      )
    )
  ].sort((a, b) => a.localeCompare(b));

  return {
    licenseCount: licenses.length,
    localeCount: licenses.reduce(
      (sum, license) => sum + (license.locales?.length ?? 0),
      0
    ),
    identifiers: licenses
      .map((license) => license.identifier)
      .filter((value): value is string => Boolean(value))
      .sort((a, b) => a.localeCompare(b)),
    languageCodes
  };
}

export function toManifestFiles(parsed: {
  chunks?: Array<{
    files?: Array<{
      name?: string;
      size?: unknown;
      isDir?: boolean;
      sliceList?: Array<{ downloadSize?: unknown }>;
    }>;
  }>;
}): ManifestFileEntry[] {
  return (parsed.chunks ?? [])
    .flatMap((chunk) => chunk.files ?? [])
    .map((file) => ({
      path: file.name ?? '(unknown)',
      installBytes: toBigInt(file.size).toString(),
      downloadBytes: (file.sliceList ?? [])
        .reduce((sum, slice) => sum + toBigInt(slice.downloadSize), 0n)
        .toString(),
      sliceCount: file.sliceList?.length ?? 0,
      isDirectory: Boolean(file.isDir)
    }))
    .sort((a, b) => {
      const sizeDiff = BigInt(b.installBytes) - BigInt(a.installBytes);
      if (sizeDiff !== 0n) {
        return sizeDiff > 0n ? 1 : -1;
      }

      return a.path.localeCompare(b.path);
    });
}

export function filterManifestFiles(
  files: ManifestFileEntry[],
  match: string | undefined,
  prefixMatch = false
): ManifestFileEntry[] {
  if (!match) {
    return files;
  }

  return files.filter((file) =>
    manifestPathMatches(file.path, match, prefixMatch)
  );
}

export function summarizeManifestFileSubset(files: ManifestFileEntry[]): {
  installBytes: string;
  downloadBytes: string;
  fileCount: number;
} {
  return {
    installBytes: files
      .reduce((sum, file) => sum + BigInt(file.installBytes), 0n)
      .toString(),
    downloadBytes: files
      .reduce((sum, file) => sum + BigInt(file.downloadBytes), 0n)
      .toString(),
    fileCount: files.length
  };
}

export class ManifestService {
  private readonly httpClient: HttpClient;

  public constructor(
    private readonly paths: AppPaths,
    config: RuntimeConfig,
    logger: Logger,
    private readonly productService: ProductService,
    private readonly publicCatalog: PublicCatalogService,
    private readonly demuxService?: DemuxService,
    httpClient?: HttpClient
  ) {
    this.httpClient =
      httpClient ?? new HttpClient(config, logger.child('manifest-http'));
  }

  public async getManifestInfo(query: string): Promise<ManifestInfo> {
    return this.toManifestInfo(await this.loadPublicManifestFixture(query));
  }

  public async getLiveManifestInfo(
    query: string,
    options: { includeAssetDetails?: boolean } = {}
  ): Promise<ManifestInfo> {
    return this.toManifestInfo(await this.loadLiveManifest(query, options));
  }

  public async getManifestFiles(query: string): Promise<ManifestFileEntry[]> {
    return this.toManifestFiles(await this.loadPublicManifestFixture(query));
  }

  public async getLiveManifestFiles(
    query: string
  ): Promise<ManifestFileEntry[]> {
    return this.toManifestFiles(await this.loadLiveManifest(query));
  }

  public async getDownloadPlan(
    query: string,
    options: { match?: string; prefixMatch?: boolean } = {}
  ): Promise<DownloadPlan> {
    return this.toDownloadPlan(
      await this.loadPublicManifestFixture(query),
      options
    );
  }

  public async getLiveDownloadPlan(
    query: string,
    options: { match?: string; prefixMatch?: boolean } = {}
  ): Promise<DownloadPlan> {
    return this.toDownloadPlan(await this.loadLiveManifest(query), options);
  }

  public async destroy(): Promise<void> {
    await this.demuxService?.destroy();
  }

  private toManifestInfo(loaded: LoadedManifestSource): ManifestInfo {
    if (!loaded.parsed || !loaded.selectedManifestHash) {
      return {
        title: loaded.title,
        productId: loaded.productId,
        manifestHashes: loaded.manifestHashes,
        selectedManifestHash: loaded.selectedManifestHash,
        rawFixtureUrl: loaded.rawFixtureUrl,
        rawSourceUrl: loaded.rawSourceUrl,
        metadataUrl: loaded.metadataUrl,
        licensesUrl: loaded.licensesUrl,
        status: loaded.status,
        notes: loaded.notes
      };
    }

    return {
      title: loaded.title,
      productId: loaded.productId,
      manifestHashes: loaded.manifestHashes,
      selectedManifestHash: loaded.selectedManifestHash,
      parsedManifest: summarizeParsedManifest(
        loaded.parsed as Parameters<typeof summarizeParsedManifest>[0],
        loaded.selectedManifestHash
      ),
      parsedMetadata: loaded.parsedMetadata
        ? summarizeParsedMetadata(
            loaded.parsedMetadata as Parameters<
              typeof summarizeParsedMetadata
            >[0]
          )
        : undefined,
      parsedLicenses: loaded.parsedLicenses
        ? summarizeParsedLicenses(
            loaded.parsedLicenses as Parameters<
              typeof summarizeParsedLicenses
            >[0]
          )
        : undefined,
      rawFixtureUrl: loaded.rawFixtureUrl,
      rawSourceUrl: loaded.rawSourceUrl,
      metadataUrl: loaded.metadataUrl,
      licensesUrl: loaded.licensesUrl,
      status: loaded.status,
      notes: loaded.notes
    };
  }

  private toManifestFiles(loaded: LoadedManifestSource): ManifestFileEntry[] {
    if (!loaded.parsed) {
      return [];
    }

    return toManifestFiles(
      loaded.parsed as Parameters<typeof toManifestFiles>[0]
    );
  }

  private toDownloadPlan(
    loaded: LoadedManifestSource,
    options: { match?: string; prefixMatch?: boolean } = {}
  ): DownloadPlan {
    const info = this.toManifestInfo(loaded);
    const files = this.toManifestFiles(loaded);
    const filteredFiles = filterManifestFiles(
      files,
      options.match,
      options.prefixMatch
    );
    const subsetSummary = summarizeManifestFileSubset(filteredFiles);
    const isFiltered = Boolean(options.match);

    return {
      title: info.title,
      productId: info.productId,
      selectedManifestHash: info.selectedManifestHash,
      status: info.status,
      installBytes: isFiltered
        ? subsetSummary.installBytes
        : info.parsedManifest?.installBytes,
      downloadBytes: isFiltered
        ? subsetSummary.downloadBytes
        : info.parsedManifest?.downloadBytes,
      chunkCount: isFiltered ? undefined : info.parsedManifest?.chunkCount,
      fileCount: isFiltered
        ? subsetSummary.fileCount
        : info.parsedManifest?.fileCount,
      largestFiles: filteredFiles.slice(0, 10),
      notes: isFiltered
        ? [
            ...info.notes,
            `Download plan was filtered to manifest paths matching normalized ${options.prefixMatch ? 'prefix' : 'substring'} "${options.match}".`,
            'Chunk count is omitted for filtered plans because the current manifest summary is file-based, not chunk-membership-based.'
          ]
        : info.notes
    };
  }

  private async loadLiveManifest(
    query: string,
    options: { includeAssetDetails?: boolean } = {}
  ): Promise<LoadedManifestSource> {
    if (!this.demuxService) {
      throw new Error('Live Demux manifest support was not configured.');
    }

    const liveManifest = await this.demuxService.parseLiveManifest(
      query,
      options
    );
    return {
      title: liveManifest.download.game.title,
      productId:
        liveManifest.download.game.publicProductId ??
        liveManifest.download.game.demuxProductId,
      manifestHashes: [liveManifest.download.manifestHash],
      selectedManifestHash: liveManifest.download.manifestHash,
      rawSourceUrl: liveManifest.download.manifestUrl,
      metadataUrl: liveManifest.download.metadataUrl,
      licensesUrl: liveManifest.download.licensesUrl,
      status: 'parsed-live-demux',
      notes: [
        'Manifest data came from a live Demux download-service URL for an owned product.',
        ...liveManifest.download.notes
      ],
      parsed: liveManifest.parsed,
      parsedMetadata: liveManifest.parsedMetadata,
      parsedLicenses: liveManifest.parsedLicenses
    };
  }

  private async loadPublicManifestFixture(
    query: string
  ): Promise<LoadedManifestSource> {
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

    const { UbisoftFileParser } = await loadUbisoftDemuxModule();
    const parser = new UbisoftFileParser();
    const parsed = parser.parseDownloadManifest(Buffer.from(rawResponse.body));

    return {
      title: resolved.info.title,
      productId: resolved.info.productId,
      manifestHashes,
      selectedManifestHash,
      rawFixtureUrl,
      status: 'parsed-public-fixture',
      notes: [
        'Manifest data came from the public UplayManifests GitHub dataset, not a live Ubisoft download-service session.'
      ],
      parsed
    };
  }
}
