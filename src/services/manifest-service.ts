import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type {
  DownloadPlan,
  ManifestFileEntry,
  ManifestInfo,
  ParsedManifestSummary
} from '../models/manifest';
import type { Logger } from '../util/logger';
import { HttpClient } from '../core/http';
import { loadUbisoftDemuxModule } from '../core/ubisoft-demux-loader';
import type { ProductService } from './product-service';
import type { PublicCatalogService } from './public-catalog-service';

interface LoadedManifestFixture {
  title: string;
  productId?: number;
  manifestHashes: string[];
  selectedManifestHash?: string;
  rawFixtureUrl?: string;
  status: ManifestInfo['status'];
  notes: string[];
  parsed?: unknown;
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
    const loaded = await this.loadManifestFixture(query);
    if (!loaded.parsed || !loaded.selectedManifestHash) {
      return {
        title: loaded.title,
        productId: loaded.productId,
        manifestHashes: loaded.manifestHashes,
        selectedManifestHash: loaded.selectedManifestHash,
        rawFixtureUrl: loaded.rawFixtureUrl,
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
      rawFixtureUrl: loaded.rawFixtureUrl,
      status: loaded.status,
      notes: loaded.notes
    };
  }

  public async getManifestFiles(query: string): Promise<ManifestFileEntry[]> {
    const loaded = await this.loadManifestFixture(query);
    if (!loaded.parsed) {
      return [];
    }

    return toManifestFiles(
      loaded.parsed as Parameters<typeof toManifestFiles>[0]
    );
  }

  public async getDownloadPlan(query: string): Promise<DownloadPlan> {
    const info = await this.getManifestInfo(query);
    const files = await this.getManifestFiles(query);

    return {
      title: info.title,
      productId: info.productId,
      selectedManifestHash: info.selectedManifestHash,
      status: info.status,
      installBytes: info.parsedManifest?.installBytes,
      downloadBytes: info.parsedManifest?.downloadBytes,
      chunkCount: info.parsedManifest?.chunkCount,
      fileCount: info.parsedManifest?.fileCount,
      largestFiles: files.slice(0, 10),
      notes: info.notes
    };
  }

  private async loadManifestFixture(
    query: string
  ): Promise<LoadedManifestFixture> {
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
