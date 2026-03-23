import { createHash } from 'node:crypto';
import { mkdir, open, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import { loadUbisoftDemuxModule } from '../core/ubisoft-demux-loader';
import type { AppPaths, RuntimeConfig } from '../models/config';
import { zstdDecompressSync } from 'node:zlib';
import type {
  DemuxDownloadUrlsInfo,
  DemuxExtractedFileResult,
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

function normalizeManifestPathForMatch(value: string): string {
  return value.replaceAll('\\', '/').toLowerCase();
}

function sha1Base64(value: Buffer): string {
  return createHash('sha1').update(value).digest('base64');
}

function chunkArray<T>(items: T[], chunkSize: number): T[][] {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
}

export class DemuxService {
  private readonly authService: AuthService;
  private readonly demuxClient: DemuxClient;
  private readonly httpClient: HttpClient;

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
      const result = await this.demuxClient.getDownloadUrlsForRelativePaths(
        session,
        productId,
        candidateChunk
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

    const files = [] as DemuxSliceDownloadResult['files'];
    for (const entry of sliceUrls.urls) {
      let successfulUrl: string | undefined;
      let body: Buffer | undefined;
      let lastStatus: number | undefined;

      for (const url of entry.urls) {
        const response = await this.httpClient.requestRaw(url, {
          retryCount: 0,
          timeoutMs: 60000
        });
        lastStatus = response.status;
        if (response.status === 200) {
          successfulUrl = url;
          body = Buffer.from(response.body);
          break;
        }
      }

      if (!successfulUrl || !body) {
        throw new Error(
          `Fetching slice ${entry.relativePath} failed for all candidate URLs${lastStatus !== undefined ? ` (last HTTP ${lastStatus})` : ''}.`
        );
      }

      const fileName = entry.relativePath.split('/').at(-1) ?? 'slice.bin';
      const filePath = path.join(resolvedOutputDir, `${fileName}.slice`);
      await writeFile(filePath, body);
      files.push({
        relativePath: entry.relativePath,
        filePath,
        bytes: body.length,
        url: successfulUrl
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
        'This command downloads raw slice payloads only. It does not reconstruct final installed game files yet.'
      ]
    };
  }

  public async extractFile(
    query: string,
    manifestPath: string,
    outputPath?: string
  ): Promise<DemuxExtractedFileResult> {
    const { download, parsed } = await this.parseLiveManifest(query);
    const files =
      (
        parsed as { chunks?: Array<{ files?: ParsedManifestFileEntry[] }> }
      ).chunks?.flatMap((chunk) => chunk.files ?? []) ?? [];
    const normalizedManifestPath = normalizeManifestPathForMatch(manifestPath);
    const file = files.find(
      (entry) =>
        !entry.isDir &&
        typeof entry.name === 'string' &&
        normalizeManifestPathForMatch(entry.name) === normalizedManifestPath
    );

    if (!file?.name) {
      throw new UserFacingError(
        `No live manifest file matched "${manifestPath}" for ${download.game.title}.`
      );
    }

    if (!file.sliceList || file.sliceList.length === 0) {
      throw new UserFacingError(
        `Manifest file "${file.name}" did not expose slice metadata for extraction.`
      );
    }

    const sliceHexHashes = [
      ...new Set(
        file.sliceList
          .map((slice) => slice.downloadSha1)
          .filter((value): value is string | Buffer => Boolean(value))
          .map((value) => sliceTokenToHex(value))
      )
    ];
    const session = await this.authService.ensureValidSession();
    const { responsesByHash } = await this.resolveSliceUrlResponses(
      session,
      download.game.demuxProductId,
      sliceHexHashes
    );
    const resolvedOutputPath =
      outputPath ??
      path.join(
        this.paths.debugDir,
        'demux-files',
        `${download.game.demuxProductId}_${download.manifestHash}`,
        file.name.replaceAll('\\', path.sep)
      );
    await mkdir(path.dirname(resolvedOutputPath), { recursive: true });

    const handle = await open(resolvedOutputPath, 'w');
    const decompressedByPath = new Map<string, Buffer>();
    let bytesDownloaded = 0;
    let bytesWritten = 0;
    let nextImplicitOffset = 0;
    let validatedSliceHashCount = 0;
    const shouldInferSequentialOffsets =
      file.sliceList.length > 1 &&
      file.sliceList.every((slice) => toNumber(slice.fileOffset) === 0);

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

        const relativePath = responseEntry.relativePath;
        let decompressedBody = decompressedByPath.get(relativePath);
        if (!decompressedBody) {
          let compressedBody: Buffer | undefined;
          let lastStatus: number | undefined;
          for (const url of responseEntry.urls) {
            const response = await this.httpClient.requestRaw(url, {
              retryCount: 0,
              timeoutMs: 60000
            });
            lastStatus = response.status;
            if (response.status === 200) {
              compressedBody = Buffer.from(response.body);
              bytesDownloaded += compressedBody.length;
              break;
            }
          }

          if (!compressedBody) {
            throw new Error(
              `Fetching slice ${relativePath} failed for all candidate URLs${lastStatus !== undefined ? ` (last HTTP ${lastStatus})` : ''}.`
            );
          }

          decompressedBody = this.decompressSliceBody(compressedBody);
          decompressedByPath.set(relativePath, decompressedBody);
        }

        const expectedSize = toNumber(slice.size);
        if (expectedSize > 0 && decompressedBody.length !== expectedSize) {
          throw new Error(
            `Slice ${relativePath} decompressed to ${decompressedBody.length} bytes but manifest expected ${expectedSize}.`
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
              `Slice ${relativePath} decompressed SHA-1 ${actualBase64} but manifest file slice expected ${expectedBase64}.`
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
      }
    } finally {
      await handle.close();
    }

    return {
      title: download.game.title,
      demuxProductId: download.game.demuxProductId,
      publicProductId: download.game.publicProductId,
      manifestHash: download.manifestHash,
      manifestPath: file.name,
      outputPath: resolvedOutputPath,
      sliceCount: file.sliceList.length,
      bytesDownloaded,
      bytesWritten,
      notes: [
        validatedSliceHashCount > 0
          ? `Validated ${validatedSliceHashCount} decompressed slice SHA-1 values against manifest file hashes.`
          : 'Manifest file did not expose per-slice decompressed SHA-1 hashes for validation.',
        'This command experimentally reconstructs a single manifest file from live slice payloads. It is not a full installer/update engine yet.'
      ]
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
    if (body.subarray(0, 4).equals(zstdMagic)) {
      return Buffer.from(zstdDecompressSync(body));
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
