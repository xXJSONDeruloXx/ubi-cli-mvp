import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { AuthService } from '../core/auth-service';
import { DemuxClient } from '../core/demux-client';
import { HttpClient } from '../core/http';
import { loadUbisoftDemuxModule } from '../core/ubisoft-demux-loader';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type {
  DemuxDownloadUrlsInfo,
  DemuxOwnedGame,
  DemuxSliceDownloadResult,
  DemuxSliceUrlsInfo,
  LiveManifestDownload
} from '../models/demux';
import type { ProductConfigSummary } from '../models/product';
import { UserFacingError } from '../util/errors';
import { collectUniqueSlicePaths } from '../util/demux-slices';
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
      urls: result.responses,
      notes: [
        'Signed URLs came from the live Demux download service using an ownership token for this entitled product.'
      ]
    };
  }

  public async getSliceUrls(
    query: string,
    limit = 20
  ): Promise<DemuxSliceUrlsInfo> {
    const { download, parsed } = await this.parseLiveManifest(query);
    const allSlicePaths = collectUniqueSlicePaths(
      parsed as Parameters<typeof collectUniqueSlicePaths>[0]
    );
    const requestedPaths = allSlicePaths.slice(0, limit);
    const session = await this.authService.ensureValidSession();
    const result = await this.demuxClient.getDownloadUrlsForRelativePaths(
      session,
      download.game.demuxProductId,
      requestedPaths
    );

    return {
      title: download.game.title,
      demuxProductId: download.game.demuxProductId,
      publicProductId: download.game.publicProductId,
      manifestHash: download.manifestHash,
      totalUniqueSliceCount: allSlicePaths.length,
      requestedSliceCount: requestedPaths.length,
      ownershipTokenExpiresAt: result.ownershipTokenExpiresAt,
      urls: result.responses,
      notes: [
        'Slice URLs were derived from the parsed live manifest and requested from the Demux download service.'
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

  public async downloadLiveManifest(
    query: string
  ): Promise<LiveManifestDownload> {
    const game = await this.resolveOwnedGame(query);
    const urls = await this.getDownloadUrls(query);
    const manifestUrl = urls.urls.find((entry) =>
      entry.relativePath.endsWith('.manifest')
    )?.urls[0];
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

    return {
      game,
      manifestHash: urls.manifestHash,
      manifestUrl,
      metadataUrl: urls.urls.find((entry) =>
        entry.relativePath.endsWith('.metadata')
      )?.urls[0],
      licensesUrl: urls.urls.find((entry) =>
        entry.relativePath.endsWith('.licenses')
      )?.urls[0],
      body: Buffer.from(response.body)
    };
  }

  public async parseLiveManifest(query: string): Promise<{
    download: LiveManifestDownload;
    parsed: unknown;
  }> {
    const download = await this.downloadLiveManifest(query);
    const { UbisoftFileParser } = await loadUbisoftDemuxModule();
    const parser = new UbisoftFileParser();
    const parsed = parser.parseDownloadManifest(download.body);

    return {
      download,
      parsed
    };
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
