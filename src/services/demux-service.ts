import { createHash } from 'node:crypto';
import { mkdir, open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import { loadUbisoftDemuxModule } from '../core/ubisoft-demux-loader';
import type { AppPaths, RuntimeConfig } from '../models/config';
import { inflateSync, zstdDecompressSync } from 'node:zlib';
import type {
  DemuxDownloadUrlsInfo,
  DemuxExtractedFileResult,
  DemuxExtractedFilesResult,
  DemuxOwnedGame,
  DemuxSliceDownloadResult,
  DemuxSliceUrlsInfo,
  LiveManifestDownload
} from '../models/demux';
import type { ProductConfigSummary } from '../models/product';
import { UserFacingError } from '../util/errors';
import {
  collectUniqueSliceHexHashes,
  sliceHexToCandidateRelativePaths,
  sliceTokenToHex
} from '../util/demux-slices';
import { normalizeManifestPathForMatch } from '../util/manifest-paths';
import { normalizeForMatch, scoreTitleMatch } from '../util/matching';
import type { Logger } from '../util/logger';
import type { ProductService } from './product-service';
import type { PublicCatalogService } from './public-catalog-service';

interface DemuxOwnedGamePayload {
  productId: number;
  owned: boolean;
  state: number;
  productType: number;
  productAssociations?: number[];
  configuration?: string;
  gameCode?: string;
  activeBranchId?: number;
  availableBranches?: Array<{
    branchId: number;
    branchName: string;
  }>;
  ubiservicesSpaceId?: string;
  ubiservicesAppId?: string;
  latestManifest?: string;
}

interface ParsedConfiguration {
  version?: number;
  root?: {
    name?: string;
    installer?: {
      publisher?: string;
      help_url?: string;
    };
    help_url?: string;
    uplay?: {
      game_code?: string;
      achievements_sync_id?: string;
    };
  };
  localizations?: {
    default?: Record<string, string | null>;
    'en-US'?: Record<string, string | null>;
    'en-CA'?: Record<string, string | null>;
  };
}

interface ParseLiveManifestOptions {
  includeAssetDetails?: boolean;
}

interface ParsedManifestSliceEntry {
  downloadSha1?: string | Buffer;
  fileOffset?: unknown;
  size?: unknown;
}

interface ParsedManifestFileEntry {
  name?: string;
  size?: unknown;
  isDir?: boolean;
  slices?: Array<string | Buffer>;
  sliceList?: ParsedManifestSliceEntry[];
}

interface SliceResponseEntry {
  relativePath: string;
  result: number;
  urls: string[];
}

interface ExtractionCache {
  decompressedByHash: Map<string, Buffer>;
  compressedByHash: Map<string, Buffer>;
  inFlightDecompressedByHash: Map<
    string,
    Promise<{ body: Buffer; bytesDownloaded: number }>
  >;
  remainingReferencesByHash: Map<string, number>;
  refreshSliceEntry?: (
    sliceHash: string
  ) => Promise<SliceResponseEntry | undefined>;
  refreshedUrlCount: number;
  skippedExistingFileCount: number;
  diskCacheHitCount: number;
  memoryReuseHitCount: number;
  networkFetchCount: number;
}

interface PreparedLiveManifestExtraction {
  download: LiveManifestDownload;
  files: ParsedManifestFileEntry[];
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') {
    return value;
  }

  if (typeof value === 'bigint') {
    return Number(value);
  }

  if (typeof value === 'string' && /^\d+$/.test(value)) {
    return Number(value);
  }

  if (typeof value === 'object' && value !== null) {
    const maybeStringifiable = value as { toString?: () => string };
    if (typeof maybeStringifiable.toString === 'function') {
      const rendered = maybeStringifiable.toString();
      if (/^\d+$/.test(rendered)) {
        return Number(rendered);
      }
    }
  }

  return 0;
}

function sha1Base64(value: Buffer): string {
  return createHash('sha1').update(value).digest('base64');
}

const SLICE_FETCH_TIMEOUT_MS = 300_000;
const SLICE_FETCH_RETRY_COUNT = 1;

function isLikelyZlibFrame(body: Buffer): boolean {
  if (body.length < 2) {
    return false;
  }

  const cmf = body[0];
  const flg = body[1];
  if ((cmf & 0x0f) !== 0x08) {
    return false;
  }

  return ((cmf << 8) + flg) % 31 === 0;
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolveValue, rejectValue) => {
    resolve = resolveValue;
    reject = rejectValue;
  });

  return { promise, resolve, reject };
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const concurrency = Math.max(1, limit);
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex;
      nextIndex += 1;
      if (index >= items.length) {
        return;
      }

      results[index] = await worker(items[index], index);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () =>
      runWorker()
    )
  );

  return results;
}

export class DemuxService {
  private readonly authService: AuthService;
  private readonly demuxClient: DemuxClient;
  private readonly httpClient: HttpClient;
  private demuxRequestQueue: Promise<void> = Promise.resolve();

  public constructor(
    private readonly paths: AppPaths,
    config: RuntimeConfig,
    logger: Logger,
    private readonly publicCatalog: PublicCatalogService,
    private readonly productService?: ProductService,
    authService?: AuthService,
    demuxClient?: DemuxClient,
    httpClient?: HttpClient
  ) {
    this.authService =
      authService ?? new AuthService(paths, config, logger.child('auth'));
    this.demuxClient =
      demuxClient ?? new DemuxClient(config, logger.child('demux-client'));
    this.httpClient =
      httpClient ?? new HttpClient(config, logger.child('demux-http'));
  }

  public async listOwnedGames(): Promise<DemuxOwnedGame[]> {
    const session = await this.authService.ensureValidSession();
    const rawGames = (await this.demuxClient.listOwnedGames(
      session
    )) as DemuxOwnedGamePayload[];

    const items = await Promise.all(
      rawGames.map((game) => this.normalizeOwnedGame(game))
    );
    return items.sort((a, b) => a.title.localeCompare(b.title));
  }

  public async resolveOwnedGame(query: string): Promise<DemuxOwnedGame> {
    const items = await this.listOwnedGames();
    const trimmedQuery = query.trim();
    const directMatch = items.find((item) => {
      if (String(item.demuxProductId) === trimmedQuery) {
        return true;
      }

      if (
        item.publicProductId !== undefined &&
        String(item.publicProductId) === trimmedQuery
      ) {
        return true;
      }

      return (
        item.spaceId?.toLowerCase() === trimmedQuery.toLowerCase() ||
        item.appId?.toLowerCase() === trimmedQuery.toLowerCase()
      );
    });
    if (directMatch) {
      return directMatch;
    }

    if (this.productService) {
      try {
        const resolved = await this.productService.resolveProduct(query);
        const bridgeMatch = items.find(
          (item) =>
            (resolved.info.spaceId !== undefined &&
              item.spaceId === resolved.info.spaceId) ||
            (resolved.info.appId !== undefined &&
              item.appId === resolved.info.appId) ||
            (resolved.info.productId !== undefined &&
              item.publicProductId === resolved.info.productId)
        );
        if (bridgeMatch) {
          return bridgeMatch;
        }
      } catch {
        // Fall back to Demux-only title matching below.
      }
    }

    const scored = items
      .map((item) => ({ item, score: scoreTitleMatch(query, item.title) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);
    if (scored[0]?.item) {
      return scored[0].item;
    }

    throw new UserFacingError(
      `No Demux-owned Ubisoft product matched "${query}". Try \`ubi demux-list\` or use a Demux/public product ID, Space ID, or App ID.`
    );
  }

  public async getDownloadUrls(query: string): Promise<DemuxDownloadUrlsInfo> {
    const game = await this.resolveOwnedGame(query);
    const manifestHash = game.latestManifest?.trim();
    if (!manifestHash) {
      throw new UserFacingError(
        `Demux-owned product ${game.demuxProductId} does not expose a live manifest hash.`
      );
    }

    const session = await this.authService.ensureValidSession();
    const result = await this.demuxClient.getManifestAssetUrls(
      session,
      game.demuxProductId,
      manifestHash
    );

    return {
      title: game.title,
      demuxProductId: game.demuxProductId,
      publicProductId: game.publicProductId,
      manifestHash,
      ownershipTokenExpiresAt: result.ownershipTokenExpiresAt,
      manifestUrl: result.manifestUrl,
      metadataUrl: result.metadataUrl,
      licensesUrl: result.licensesUrl,
      urls: result.responses,
      notes: [
        'Signed URLs came from the live Demux download service using an ownership token for this entitled product.'
      ]
    };
  }

  private async withSerializedDemuxRequest<T>(
    request: () => Promise<T>
  ): Promise<T> {
    const next = createDeferred<T>();
    const previous = this.demuxRequestQueue;
    this.demuxRequestQueue = next.promise.then(
      () => undefined,
      () => undefined
    );

    try {
      await previous;
      const result = await request();
      next.resolve(result);
      return result;
    } catch (error) {
      next.reject(error);
      throw error;
    }
  }

  private async resolveSliceUrlResponses(
    session: Awaited<ReturnType<AuthService['ensureValidSession']>>,
    productId: number,
    sliceHexHashes: string[]
  ): Promise<{
    ownershipTokenExpiresAt?: string;
    responsesByHash: Map<
      string,
      { relativePath: string; result: number; urls: string[] }
    >;
  }> {
    const responses = [] as Array<{
      relativePath: string;
      result: number;
      urls: string[];
    }>;
    let ownershipTokenExpiresAt: string | undefined;

    for (const candidateChunk of chunkArray(
      sliceHexHashes.flatMap((hash) => sliceHexToCandidateRelativePaths(hash)),
      256
    )) {
      const result = await this.withSerializedDemuxRequest(() =>
        this.demuxClient.getDownloadUrlsForRelativePaths(
          session,
          productId,
          candidateChunk
        )
      );
      ownershipTokenExpiresAt =
        result.ownershipTokenExpiresAt ?? ownershipTokenExpiresAt;
      responses.push(...result.responses);
    }

    const resolved = new Map<
      string,
      { relativePath: string; result: number; urls: string[] }
    >();
    for (const response of responses) {
      const hash = response.relativePath.split('/').at(-1)?.toUpperCase();
      if (!hash) {
        continue;
      }

      const existing = resolved.get(hash);
      if (existing) {
        existing.urls.push(...response.urls);
        continue;
      }

      resolved.set(hash, {
        relativePath: response.relativePath,
        result: response.result,
        urls: [...response.urls]
      });
    }

    return {
      ownershipTokenExpiresAt,
      responsesByHash: resolved
    };
  }

  public async getSliceUrls(
    query: string,
    limit = 20
  ): Promise<DemuxSliceUrlsInfo> {
    const { download, parsed } = await this.parseLiveManifest(query);
    const allSliceHashes = collectUniqueSliceHexHashes(
      parsed as Parameters<typeof collectUniqueSliceHexHashes>[0]
    );
    const requestedHashes = allSliceHashes.slice(0, limit);
    const session = await this.authService.ensureValidSession();
    const { ownershipTokenExpiresAt, responsesByHash } =
      await this.resolveSliceUrlResponses(
        session,
        download.game.demuxProductId,
        requestedHashes
      );
    const resolvedResponses = requestedHashes
      .map((hash) => responsesByHash.get(hash))
      .filter(
        (
          value
        ): value is { relativePath: string; result: number; urls: string[] } =>
          Boolean(value)
      );

    return {
      title: download.game.title,
      demuxProductId: download.game.demuxProductId,
      publicProductId: download.game.publicProductId,
      manifestHash: download.manifestHash,
      totalUniqueSliceCount: allSliceHashes.length,
      requestedSliceCount: requestedHashes.length,
      ownershipTokenExpiresAt,
      urls: resolvedResponses,
      notes: [
        'Slice URLs were derived from the parsed live manifest and requested from the Demux download service using per-slice candidate path resolution.'
      ]
    };
  }

  public async downloadSlices(
    query: string,
    limit = 5,
    outputDir?: string
  ): Promise<DemuxSliceDownloadResult> {
    const sliceUrls = await this.getSliceUrls(query, limit);
    const resolvedOutputDir =
      outputDir ??
      path.join(
        this.paths.debugDir,
        'demux-slices',
        `${sliceUrls.demuxProductId}_${sliceUrls.manifestHash}`
      );
    await mkdir(resolvedOutputDir, { recursive: true });

    const transferCache: ExtractionCache = {
      decompressedByHash: new Map<string, Buffer>(),
      compressedByHash: new Map<string, Buffer>(),
      inFlightDecompressedByHash: new Map<
        string,
        Promise<{ body: Buffer; bytesDownloaded: number }>
      >(),
      remainingReferencesByHash: new Map(
        sliceUrls.urls
          .map((entry) => entry.relativePath.split('/').at(-1)?.toUpperCase())
          .filter((value): value is string => Boolean(value))
          .map((hash) => [hash, 1])
      ),
      refreshedUrlCount: 0,
      skippedExistingFileCount: 0,
      diskCacheHitCount: 0,
      memoryReuseHitCount: 0,
      networkFetchCount: 0
    };
    const files = [] as DemuxSliceDownloadResult['files'];
    for (const entry of sliceUrls.urls) {
      const sliceHash = entry.relativePath.split('/').at(-1)?.toUpperCase();
      if (!sliceHash) {
        throw new Error(
          `Slice path ${entry.relativePath} did not contain a hash.`
        );
      }

      const fetched = await this.fetchCompressedSlice(
        entry,
        sliceHash,
        transferCache
      );
      const fileName = entry.relativePath.split('/').at(-1) ?? 'slice.bin';
      const filePath = path.join(resolvedOutputDir, `${fileName}.slice`);
      await writeFile(filePath, fetched.body);
      files.push({
        relativePath: entry.relativePath,
        filePath,
        bytes: fetched.body.length,
        url: fetched.source
      });
    }

    return {
      title: sliceUrls.title,
      demuxProductId: sliceUrls.demuxProductId,
      publicProductId: sliceUrls.publicProductId,
      manifestHash: sliceUrls.manifestHash,
      outputDir: resolvedOutputDir,
      downloadedCount: files.length,
      files,
      notes: [
        this.describeSliceTransferStats(transferCache),
        'This command downloads raw slice payloads only. It does not reconstruct final installed game files yet.'
      ]
    };
  }

  public async extractFile(
    query: string,
    manifestPath: string,
    outputPath?: string
  ): Promise<DemuxExtractedFileResult> {
    const prepared = await this.prepareLiveManifestExtraction(query);
    const normalizedManifestPath = normalizeManifestPathForMatch(manifestPath);
    const file = prepared.files.find(
      (entry) =>
        !entry.isDir &&
        typeof entry.name === 'string' &&
        normalizeManifestPathForMatch(entry.name) === normalizedManifestPath
    );

    if (!file?.name) {
      throw new UserFacingError(
        `No live manifest file matched "${manifestPath}" for ${prepared.download.game.title}.`
      );
    }

    const sliceHexHashes = this.collectSliceHexHashesForFiles([file]);
    const session = await this.authService.ensureValidSession();
    const { responsesByHash } = await this.resolveSliceUrlResponses(
      session,
      prepared.download.game.demuxProductId,
      sliceHexHashes
    );
    const resolvedOutputPath =
      outputPath ??
      path.join(
        this.paths.debugDir,
        'demux-files',
        `${prepared.download.game.demuxProductId}_${prepared.download.manifestHash}`,
        file.name.replaceAll('\\', path.sep)
      );

    const transferCache = this.createExtractionCache([file]);
    transferCache.refreshSliceEntry = this.buildRefreshSliceEntryCallback(
      prepared.download.game.demuxProductId,
      responsesByHash
    );
    const extracted = await this.extractManifestFileToPath(
      file,
      resolvedOutputPath,
      responsesByHash,
      transferCache
    );

    return {
      title: prepared.download.game.title,
      demuxProductId: prepared.download.game.demuxProductId,
      publicProductId: prepared.download.game.publicProductId,
      manifestHash: prepared.download.manifestHash,
      manifestPath: file.name,
      outputPath: resolvedOutputPath,
      sliceCount: extracted.sliceCount,
      bytesDownloaded: extracted.bytesDownloaded,
      bytesWritten: extracted.bytesWritten,
      notes: [
        extracted.validatedSliceHashCount > 0
          ? `Validated ${extracted.validatedSliceHashCount} decompressed slice SHA-1 values against manifest file hashes.`
          : 'Manifest file did not expose per-slice decompressed SHA-1 hashes for validation.',
        this.describeSliceTransferStats(transferCache),
        'This command experimentally reconstructs a single manifest file from live slice payloads. It is not a full installer/update engine yet.'
      ]
    };
  }

  public async downloadGame(
    query: string,
    options: {
      outputDir?: string;
      workerCount?: number;
    } = {}
  ): Promise<DemuxExtractedFilesResult> {
    const prepared = await this.prepareLiveManifestExtraction(query);
    const selectedFiles = prepared.files
      .filter((entry) => !entry.isDir && typeof entry.name === 'string')
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    if (selectedFiles.length === 0) {
      throw new UserFacingError(
        `No downloadable live manifest files were available for ${prepared.download.game.title}.`
      );
    }

    const sliceReferenceCount = selectedFiles.reduce(
      (sum, file) => sum + (file.sliceList?.length ?? 0),
      0
    );
    const uniqueSliceHashes = this.collectSliceHexHashesForFiles(selectedFiles);
    const session = await this.authService.ensureValidSession();
    const { responsesByHash } = await this.resolveSliceUrlResponses(
      session,
      prepared.download.game.demuxProductId,
      uniqueSliceHashes
    );
    const resolvedOutputDir =
      options.outputDir ??
      path.join(
        this.paths.debugDir,
        'demux-game',
        `${prepared.download.game.demuxProductId}_${prepared.download.manifestHash}`
      );
    const cache = this.createExtractionCache(selectedFiles);
    cache.refreshSliceEntry = this.buildRefreshSliceEntryCallback(
      prepared.download.game.demuxProductId,
      responsesByHash
    );

    const extractedEntries = await mapLimit(
      selectedFiles,
      Math.max(1, options.workerCount ?? 4),
      async (file) => {
        if (!file.name) {
          return undefined;
        }

        const resolvedOutputPath = path.join(
          resolvedOutputDir,
          file.name.replaceAll('\\', path.sep)
        );
        const extracted = await this.extractManifestFileToPath(
          file,
          resolvedOutputPath,
          responsesByHash,
          cache
        );
        return {
          manifestPath: file.name,
          outputPath: resolvedOutputPath,
          sliceCount: extracted.sliceCount,
          bytesWritten: extracted.bytesWritten,
          bytesDownloaded: extracted.bytesDownloaded
        };
      }
    );

    const files = extractedEntries.filter(
      (
        value
      ): value is DemuxExtractedFilesResult['files'][number] & {
        bytesDownloaded: number;
      } => Boolean(value)
    );
    const bytesDownloaded = files.reduce(
      (sum, file) => sum + file.bytesDownloaded,
      0
    );
    const bytesWritten = files.reduce(
      (sum, file) => sum + file.bytesWritten,
      0
    );

    return {
      title: prepared.download.game.title,
      demuxProductId: prepared.download.game.demuxProductId,
      publicProductId: prepared.download.game.publicProductId,
      manifestHash: prepared.download.manifestHash,
      outputDir: resolvedOutputDir,
      matchedCount: selectedFiles.length,
      extractedCount: files.length,
      sliceReferenceCount,
      uniqueSliceCount: uniqueSliceHashes.length,
      bytesDownloaded,
      bytesWritten,
      files,
      notes: [
        'Selected the full live manifest file set for extraction.',
        this.describeSliceTransferStats(cache),
        'This command experimentally reconstructs an entire live manifest into a local directory tree. It is the closest current approximation of a full game download, but it is not yet a complete installer/update engine.'
      ]
    };
  }

  public async extractFiles(
    query: string,
    pathFilter: string,
    options: {
      prefixMatch?: boolean;
      limit?: number;
      outputDir?: string;
    } = {}
  ): Promise<DemuxExtractedFilesResult> {
    const prepared = await this.prepareLiveManifestExtraction(query);
    const normalizedFilter = normalizeManifestPathForMatch(pathFilter);
    const matchedFiles = prepared.files
      .filter(
        (entry) =>
          !entry.isDir &&
          typeof entry.name === 'string' &&
          (options.prefixMatch
            ? normalizeManifestPathForMatch(entry.name).startsWith(
                normalizedFilter
              )
            : normalizeManifestPathForMatch(entry.name).includes(
                normalizedFilter
              ))
      )
      .sort((a, b) => (a.name ?? '').localeCompare(b.name ?? ''));

    if (matchedFiles.length === 0) {
      throw new UserFacingError(
        `No live manifest files matched "${pathFilter}" for ${prepared.download.game.title}.`
      );
    }

    const limit = Math.max(1, options.limit ?? 10);
    const selectedFiles = matchedFiles.slice(0, limit);
    const sliceReferenceCount = selectedFiles.reduce(
      (sum, file) => sum + (file.sliceList?.length ?? 0),
      0
    );
    const uniqueSliceHashes = this.collectSliceHexHashesForFiles(selectedFiles);
    const session = await this.authService.ensureValidSession();
    const { responsesByHash } = await this.resolveSliceUrlResponses(
      session,
      prepared.download.game.demuxProductId,
      uniqueSliceHashes
    );
    const resolvedOutputDir =
      options.outputDir ??
      path.join(
        this.paths.debugDir,
        'demux-files',
        `${prepared.download.game.demuxProductId}_${prepared.download.manifestHash}`
      );
    const cache = this.createExtractionCache(selectedFiles);
    cache.refreshSliceEntry = this.buildRefreshSliceEntryCallback(
      prepared.download.game.demuxProductId,
      responsesByHash
    );

    let bytesDownloaded = 0;
    let bytesWritten = 0;
    const files: DemuxExtractedFilesResult['files'] = [];
    for (const file of selectedFiles) {
      if (!file.name) {
        continue;
      }

      const resolvedOutputPath = path.join(
        resolvedOutputDir,
        file.name.replaceAll('\\', path.sep)
      );
      const extracted = await this.extractManifestFileToPath(
        file,
        resolvedOutputPath,
        responsesByHash,
        cache
      );
      bytesDownloaded += extracted.bytesDownloaded;
      bytesWritten += extracted.bytesWritten;
      files.push({
        manifestPath: file.name,
        outputPath: resolvedOutputPath,
        sliceCount: extracted.sliceCount,
        bytesWritten: extracted.bytesWritten
      });
    }

    return {
      title: prepared.download.game.title,
      demuxProductId: prepared.download.game.demuxProductId,
      publicProductId: prepared.download.game.publicProductId,
      manifestHash: prepared.download.manifestHash,
      outputDir: resolvedOutputDir,
      matchedCount: matchedFiles.length,
      extractedCount: files.length,
      sliceReferenceCount,
      uniqueSliceCount: uniqueSliceHashes.length,
      bytesDownloaded,
      bytesWritten,
      files,
      notes: [
        options.prefixMatch
          ? 'Matched files by normalized manifest-path prefix.'
          : 'Matched files by normalized manifest-path substring.',
        this.describeSliceTransferStats(cache),
        'This command experimentally reconstructs multiple manifest files from live slice payloads and reuses downloaded slices across matching files when possible.'
      ]
    };
  }

  private async prepareLiveManifestExtraction(
    query: string
  ): Promise<PreparedLiveManifestExtraction> {
    const { download, parsed } = await this.parseLiveManifest(query);
    return {
      download,
      files: this.getParsedManifestFiles(parsed)
    };
  }

  private getParsedManifestFiles(parsed: unknown): ParsedManifestFileEntry[] {
    return (
      (
        parsed as { chunks?: Array<{ files?: ParsedManifestFileEntry[] }> }
      ).chunks?.flatMap((chunk) => chunk.files ?? []) ?? []
    );
  }

  private collectSliceHexHashesForFiles(
    files: ParsedManifestFileEntry[]
  ): string[] {
    return [
      ...new Set(
        files.flatMap((file) =>
          (file.sliceList ?? [])
            .map((slice) => slice.downloadSha1)
            .filter((value): value is string | Buffer => Boolean(value))
            .map((value) => sliceTokenToHex(value))
        )
      )
    ];
  }

  private countSliceReferencesForFiles(
    files: ParsedManifestFileEntry[]
  ): Map<string, number> {
    const counts = new Map<string, number>();
    for (const file of files) {
      for (const slice of file.sliceList ?? []) {
        if (!slice.downloadSha1) {
          continue;
        }

        const hash = sliceTokenToHex(slice.downloadSha1);
        counts.set(hash, (counts.get(hash) ?? 0) + 1);
      }
    }

    return counts;
  }

  private buildRefreshSliceEntryCallback(
    productId: number,
    responsesByHash: Map<string, SliceResponseEntry>
  ): (sliceHash: string) => Promise<SliceResponseEntry | undefined> {
    return async (sliceHash: string) => {
      const session = await this.authService.ensureValidSession();
      const refreshed = await this.resolveSliceUrlResponses(
        session,
        productId,
        [sliceHash]
      );
      const entry = refreshed.responsesByHash.get(sliceHash);
      if (entry) {
        responsesByHash.set(sliceHash, entry);
      }

      return entry;
    };
  }

  private createExtractionCache(
    files: ParsedManifestFileEntry[]
  ): ExtractionCache {
    return {
      decompressedByHash: new Map<string, Buffer>(),
      compressedByHash: new Map<string, Buffer>(),
      inFlightDecompressedByHash: new Map<
        string,
        Promise<{ body: Buffer; bytesDownloaded: number }>
      >(),
      remainingReferencesByHash: this.countSliceReferencesForFiles(files),
      refreshedUrlCount: 0,
      skippedExistingFileCount: 0,
      diskCacheHitCount: 0,
      memoryReuseHitCount: 0,
      networkFetchCount: 0
    };
  }

  private getSliceCachePath(sliceHash: string): string | undefined {
    if (!this.paths.cacheDir) {
      return undefined;
    }

    return path.join(this.paths.cacheDir, 'demux-slices', `${sliceHash}.slice`);
  }

  private describeSliceTransferStats(cache: ExtractionCache): string {
    return `Slice transfer stats: networkFetches=${cache.networkFetchCount} | diskCacheHits=${cache.diskCacheHitCount} | inProcessReuseHits=${cache.memoryReuseHitCount} | urlRefreshes=${cache.refreshedUrlCount} | skippedExistingFiles=${cache.skippedExistingFileCount}`;
  }

  private async requestSliceFromUrls(entry: SliceResponseEntry): Promise<{
    body?: Buffer;
    successfulUrl?: string;
    lastStatus?: number;
  }> {
    let compressedBody: Buffer | undefined;
    let successfulUrl: string | undefined;
    let lastStatus: number | undefined;
    for (const url of entry.urls) {
      const response = await this.httpClient.requestRaw(url, {
        retryCount: SLICE_FETCH_RETRY_COUNT,
        timeoutMs: SLICE_FETCH_TIMEOUT_MS
      });
      lastStatus = response.status;
      if (response.status === 200) {
        compressedBody = Buffer.from(response.body);
        successfulUrl = url;
        break;
      }
    }

    return {
      body: compressedBody,
      successfulUrl,
      lastStatus
    };
  }

  private async fetchCompressedSlice(
    entry: SliceResponseEntry,
    sliceHash: string,
    cache: ExtractionCache
  ): Promise<{ body: Buffer; bytesDownloaded: number; source: string }> {
    const inMemory = cache.compressedByHash.get(sliceHash);
    if (inMemory) {
      cache.memoryReuseHitCount += 1;
      return {
        body: inMemory,
        bytesDownloaded: 0,
        source: `memory-cache://${sliceHash}`
      };
    }

    const cachePath = this.getSliceCachePath(sliceHash);
    if (cachePath) {
      try {
        const cachedBody = await readFile(cachePath);
        cache.compressedByHash.set(sliceHash, cachedBody);
        cache.diskCacheHitCount += 1;
        return {
          body: cachedBody,
          bytesDownloaded: 0,
          source: `cache://${sliceHash}`
        };
      } catch {
        // Fall back to network.
      }
    }

    let {
      body: compressedBody,
      successfulUrl,
      lastStatus
    } = await this.requestSliceFromUrls(entry);

    if (
      (!compressedBody || !successfulUrl) &&
      lastStatus === 403 &&
      cache.refreshSliceEntry
    ) {
      const refreshedEntry = await cache.refreshSliceEntry(sliceHash);
      if (refreshedEntry) {
        cache.refreshedUrlCount += 1;
        ({
          body: compressedBody,
          successfulUrl,
          lastStatus
        } = await this.requestSliceFromUrls(refreshedEntry));
        entry = refreshedEntry;
      }
    }

    if (!compressedBody || !successfulUrl) {
      throw new Error(
        `Fetching slice ${entry.relativePath} failed for all candidate URLs${lastStatus !== undefined ? ` (last HTTP ${lastStatus})` : ''}.`
      );
    }

    if (cachePath) {
      await mkdir(path.dirname(cachePath), { recursive: true });
      await writeFile(cachePath, compressedBody);
    }
    cache.compressedByHash.set(sliceHash, compressedBody);
    cache.networkFetchCount += 1;
    return {
      body: compressedBody,
      bytesDownloaded: compressedBody.length,
      source: successfulUrl
    };
  }

  private async fetchDecompressedSlice(
    entry: SliceResponseEntry,
    sliceHash: string,
    cache: ExtractionCache
  ): Promise<{ body: Buffer; bytesDownloaded: number }> {
    const cachedBody = cache.decompressedByHash.get(sliceHash);
    if (cachedBody) {
      cache.memoryReuseHitCount += 1;
      return {
        body: cachedBody,
        bytesDownloaded: 0
      };
    }

    const inFlight = cache.inFlightDecompressedByHash.get(sliceHash);
    if (inFlight) {
      cache.memoryReuseHitCount += 1;
      return inFlight;
    }

    const promise = (async () => {
      const compressed = await this.fetchCompressedSlice(
        entry,
        sliceHash,
        cache
      );
      const body = this.decompressSliceBody(compressed.body);
      cache.decompressedByHash.set(sliceHash, body);
      return {
        body,
        bytesDownloaded: compressed.bytesDownloaded
      };
    })();
    cache.inFlightDecompressedByHash.set(sliceHash, promise);

    try {
      return await promise;
    } finally {
      cache.inFlightDecompressedByHash.delete(sliceHash);
    }
  }

  private async shouldSkipExistingExtraction(
    file: ParsedManifestFileEntry,
    outputPath: string,
    cache: ExtractionCache
  ): Promise<boolean> {
    try {
      const existing = await stat(outputPath);
      if (!existing.isFile()) {
        return false;
      }

      if (existing.size !== toNumber(file.size)) {
        return false;
      }

      cache.skippedExistingFileCount += 1;
      for (const slice of file.sliceList ?? []) {
        if (!slice.downloadSha1) {
          continue;
        }

        this.releaseSliceReference(sliceTokenToHex(slice.downloadSha1), cache);
      }

      return true;
    } catch {
      return false;
    }
  }

  private releaseSliceReference(
    sliceHash: string,
    cache: ExtractionCache
  ): void {
    const remaining = cache.remainingReferencesByHash.get(sliceHash);
    if (remaining === undefined) {
      return;
    }

    if (remaining <= 1) {
      cache.remainingReferencesByHash.delete(sliceHash);
      cache.decompressedByHash.delete(sliceHash);
      cache.compressedByHash.delete(sliceHash);
      cache.inFlightDecompressedByHash.delete(sliceHash);
      return;
    }

    cache.remainingReferencesByHash.set(sliceHash, remaining - 1);
  }

  private async extractManifestFileToPath(
    file: ParsedManifestFileEntry,
    outputPath: string,
    responsesByHash: Map<string, SliceResponseEntry>,
    cache: ExtractionCache
  ): Promise<{
    sliceCount: number;
    bytesDownloaded: number;
    bytesWritten: number;
    validatedSliceHashCount: number;
  }> {
    if (!file.name) {
      throw new Error('Manifest file entry was missing a name.');
    }

    if (!file.sliceList || file.sliceList.length === 0) {
      throw new UserFacingError(
        `Manifest file "${file.name}" did not expose slice metadata for extraction.`
      );
    }

    await mkdir(path.dirname(outputPath), { recursive: true });
    let bytesDownloaded = 0;
    let bytesWritten = 0;
    let nextImplicitOffset = 0;
    let validatedSliceHashCount = 0;
    const shouldInferSequentialOffsets =
      file.sliceList.length > 1 &&
      file.sliceList.every((slice) => toNumber(slice.fileOffset) === 0);

    if (await this.shouldSkipExistingExtraction(file, outputPath, cache)) {
      return {
        sliceCount: file.sliceList.length,
        bytesDownloaded: 0,
        bytesWritten: toNumber(file.size),
        validatedSliceHashCount: 0
      };
    }

    const handle = await open(outputPath, 'w');
    try {
      await handle.truncate(toNumber(file.size));

      for (const [index, slice] of file.sliceList.entries()) {
        if (!slice.downloadSha1) {
          throw new Error(
            `Manifest file "${file.name}" had a slice without downloadSha1.`
          );
        }

        const sliceHash = sliceTokenToHex(slice.downloadSha1);
        const responseEntry = responsesByHash.get(sliceHash);
        if (!responseEntry) {
          throw new Error(
            `Demux download service did not return a URL for slice ${sliceHash}.`
          );
        }

        const fetched = await this.fetchDecompressedSlice(
          responseEntry,
          sliceHash,
          cache
        );
        const decompressedBody = fetched.body;
        bytesDownloaded += fetched.bytesDownloaded;

        const expectedSize = toNumber(slice.size);
        if (expectedSize > 0 && decompressedBody.length !== expectedSize) {
          throw new Error(
            `Slice ${responseEntry.relativePath} decompressed to ${decompressedBody.length} bytes but manifest expected ${expectedSize}.`
          );
        }

        const expectedSliceSha1 = file.slices?.[index];
        if (expectedSliceSha1) {
          const expectedBase64 =
            typeof expectedSliceSha1 === 'string'
              ? expectedSliceSha1
              : Buffer.from(expectedSliceSha1).toString('base64');
          const actualBase64 = sha1Base64(decompressedBody);
          if (actualBase64 !== expectedBase64) {
            throw new Error(
              `Slice ${responseEntry.relativePath} decompressed SHA-1 ${actualBase64} but manifest file slice expected ${expectedBase64}.`
            );
          }

          validatedSliceHashCount += 1;
        }

        const writeOffset = shouldInferSequentialOffsets
          ? nextImplicitOffset
          : slice.fileOffset !== undefined
            ? toNumber(slice.fileOffset)
            : nextImplicitOffset;
        await handle.write(
          decompressedBody,
          0,
          decompressedBody.length,
          writeOffset
        );
        bytesWritten += decompressedBody.length;
        nextImplicitOffset = writeOffset + decompressedBody.length;
        this.releaseSliceReference(sliceHash, cache);
      }
    } finally {
      await handle.close();
    }

    return {
      sliceCount: file.sliceList.length,
      bytesDownloaded,
      bytesWritten,
      validatedSliceHashCount
    };
  }

  public async downloadLiveManifest(
    query: string,
    options: ParseLiveManifestOptions = {}
  ): Promise<LiveManifestDownload> {
    const game = await this.resolveOwnedGame(query);
    const urls = await this.getDownloadUrls(query);
    const manifestUrl = urls.manifestUrl;
    if (!manifestUrl) {
      throw new UserFacingError(
        `Demux download service did not return a manifest URL for product ${game.demuxProductId}.`
      );
    }

    const response = await this.httpClient.requestRaw(manifestUrl, {
      retryCount: 0,
      timeoutMs: 20000
    });
    if (response.status !== 200) {
      throw new Error(
        `Fetching live manifest bytes failed for product ${game.demuxProductId}: HTTP ${response.status}`
      );
    }

    const fixturePath = path.join(
      this.paths.debugDir,
      `demux_${game.demuxProductId}_${urls.manifestHash}.manifest`
    );
    await writeFile(fixturePath, response.body);

    const notes: string[] = [];
    const metadataBody = options.includeAssetDetails
      ? await this.fetchOptionalAssetBody(
          urls.metadataUrl,
          path.join(
            this.paths.debugDir,
            `demux_${game.demuxProductId}_${urls.manifestHash}.metadata`
          ),
          'metadata',
          notes
        )
      : undefined;
    const licensesBody = options.includeAssetDetails
      ? await this.fetchOptionalAssetBody(
          urls.licensesUrl,
          path.join(
            this.paths.debugDir,
            `demux_${game.demuxProductId}_${urls.manifestHash}.licenses`
          ),
          'licenses',
          notes
        )
      : undefined;

    return {
      game,
      manifestHash: urls.manifestHash,
      manifestUrl,
      metadataUrl: urls.metadataUrl,
      licensesUrl: urls.licensesUrl,
      body: Buffer.from(response.body),
      metadataBody,
      licensesBody,
      notes
    };
  }

  public async parseLiveManifest(
    query: string,
    options: ParseLiveManifestOptions = {}
  ): Promise<{
    download: LiveManifestDownload;
    parsed: unknown;
    parsedMetadata?: unknown;
    parsedLicenses?: unknown;
  }> {
    const download = await this.downloadLiveManifest(query, options);
    const { UbisoftFileParser } = await loadUbisoftDemuxModule();
    const parser = new UbisoftFileParser();
    const parsed = parser.parseDownloadManifest(download.body);

    return {
      download,
      parsed,
      parsedMetadata: download.metadataBody
        ? parser.parseDownloadMetadata(download.metadataBody)
        : undefined,
      parsedLicenses: download.licensesBody
        ? parser.parseDownloadLicenses(download.licensesBody)
        : undefined
    };
  }

  private decompressSliceBody(body: Buffer): Buffer {
    const zstdMagic = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
    if (body.length >= 4 && body.subarray(0, 4).equals(zstdMagic)) {
      return Buffer.from(zstdDecompressSync(body));
    }

    if (isLikelyZlibFrame(body)) {
      return Buffer.from(inflateSync(body));
    }

    return body;
  }

  private async fetchOptionalAssetBody(
    url: string | undefined,
    filePath: string,
    label: 'metadata' | 'licenses',
    notes: string[]
  ): Promise<Buffer | undefined> {
    if (!url) {
      notes.push(`Live ${label} URL was not exposed for this manifest.`);
      return undefined;
    }

    const response = await this.httpClient.requestRaw(url, {
      retryCount: 0,
      timeoutMs: 20000
    });
    if (response.status !== 200) {
      notes.push(
        `Fetching live ${label} bytes returned HTTP ${response.status}.`
      );
      return undefined;
    }

    const body = Buffer.from(response.body);
    await writeFile(filePath, body);
    return body;
  }

  public async getPatchInfo(): Promise<{
    latestVersion?: number;
    patchBaseUrl?: string;
    success?: boolean;
  }> {
    const patchInfo = await this.demuxClient.getPatchInfo();
    return {
      latestVersion: patchInfo?.latestVersion,
      patchBaseUrl: patchInfo?.patchBaseUrl,
      success: patchInfo?.success
    };
  }

  public async destroy(): Promise<void> {
    await this.demuxClient.destroy();
  }

  private async normalizeOwnedGame(
    game: DemuxOwnedGamePayload
  ): Promise<DemuxOwnedGame> {
    const configSummary = this.getConfigSummary(game.configuration);
    const title = configSummary?.rootName ?? `Product ${game.productId}`;
    const latestManifest = game.latestManifest?.trim();
    const catalogMatch =
      (game.ubiservicesSpaceId
        ? await this.publicCatalog.findCatalogProductBySpaceId(
            game.ubiservicesSpaceId
          )
        : undefined) ??
      (game.ubiservicesAppId
        ? await this.publicCatalog.findUniqueCatalogProductByAppId(
            game.ubiservicesAppId
          )
        : undefined) ??
      (await this.publicCatalog.findUniqueCatalogProductByTitle(title));

    return {
      title,
      demuxProductId: game.productId,
      publicProductId: catalogMatch?.productId,
      spaceId: game.ubiservicesSpaceId || catalogMatch?.spaceId,
      appId: game.ubiservicesAppId || catalogMatch?.appId,
      latestManifest:
        latestManifest && latestManifest.trim().length > 0
          ? latestManifest
          : undefined,
      owned: game.owned,
      state: game.state,
      productType: game.productType,
      gameCode: game.gameCode || configSummary?.gameCode,
      configSummary,
      productAssociations: game.productAssociations ?? [],
      branches: (game.availableBranches ?? []).map((branch) => ({
        branchId: branch.branchId,
        branchName: branch.branchName,
        active: branch.branchId === game.activeBranchId
      })),
      activeBranchId: game.activeBranchId,
      hasDownloadManifest: Boolean(
        latestManifest && normalizeForMatch(latestManifest).length > 0
      ),
      hasConfiguration: Boolean(game.configuration)
    };
  }

  private getConfigSummary(
    configuration?: string
  ): ProductConfigSummary | undefined {
    if (!configuration) {
      return undefined;
    }

    const parsed = YAML.parse(configuration) as ParsedConfiguration;
    const rootName = this.resolveLocalizedValue(parsed, parsed.root?.name);

    return {
      rootName,
      publisher: parsed.root?.installer?.publisher,
      helpUrl: parsed.root?.installer?.help_url ?? parsed.root?.help_url,
      gameCode:
        parsed.root?.uplay?.game_code ??
        parsed.root?.uplay?.achievements_sync_id,
      configurationVersion: parsed.version
    };
  }

  private resolveLocalizedValue(
    parsed: ParsedConfiguration,
    value?: string
  ): string | undefined {
    if (!value) {
      return undefined;
    }

    const localizedValue =
      parsed.localizations?.default?.[value] ??
      parsed.localizations?.['en-US']?.[value] ??
      parsed.localizations?.['en-CA']?.[value];

    if (typeof localizedValue === 'string' && localizedValue.length > 0) {
      return localizedValue;
    }

    return value;
  }
}
