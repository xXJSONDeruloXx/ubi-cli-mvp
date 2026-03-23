import type { AppPaths, RuntimeConfig } from '../models/config';
import type { LibraryItem } from '../models/library';
import type { Logger } from '../util/logger';
import { normalizeForMatch } from '../util/matching';
import { AuthService } from '../core/auth-service';
import { HttpClient } from '../core/http';
import type { PublicCatalogService } from './public-catalog-service';

interface GraphqlGameNode {
  id: string;
  spaceId: string;
  name: string;
  coverUrl?: string;
  backgroundUrl?: string;
  bannerUrl?: string;
  releaseDate?: string;
}

interface GraphqlGamesPage {
  data?: {
    viewer?: {
      games?: {
        totalCount?: number;
        nodes?: GraphqlGameNode[];
      };
    };
  };
  errors?: Array<{ message?: string }>;
}

export interface ListOwnedGamesOptions {
  dedupe?: boolean;
}

const GRAPHQL_QUERY = `query OwnedGames($limit: Int, $offset: Int) {
  viewer {
    games(limit: $limit, offset: $offset) {
      totalCount
      nodes {
        id
        spaceId
        name
        coverUrl
        backgroundUrl
        bannerUrl
        releaseDate
      }
    }
  }
}`;

function compareLibraryItems(a: LibraryItem, b: LibraryItem): number {
  const aKnown = a.productId !== undefined ? 1 : 0;
  const bKnown = b.productId !== undefined ? 1 : 0;
  if (aKnown !== bKnown) {
    return bKnown - aKnown;
  }

  const aRelease = a.releaseDate ? 1 : 0;
  const bRelease = b.releaseDate ? 1 : 0;
  if (aRelease !== bRelease) {
    return bRelease - aRelease;
  }

  return a.spaceId.localeCompare(b.spaceId);
}

export function propagateKnownMetadataByTitle(
  items: LibraryItem[]
): LibraryItem[] {
  const groups = new Map<string, LibraryItem[]>();

  for (const item of items) {
    const key = normalizeForMatch(item.title);
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return items.map((item) => {
    if (item.productId !== undefined) {
      return item;
    }

    const group = groups.get(normalizeForMatch(item.title)) ?? [];
    const knownProductIds = [
      ...new Set(
        group
          .map((entry) => entry.productId)
          .filter((value): value is number => value !== undefined)
      )
    ];

    if (knownProductIds.length !== 1) {
      return item;
    }

    const canonical = [...group].sort(compareLibraryItems)[0];
    if (!canonical?.productId) {
      return item;
    }

    return {
      ...item,
      productId: canonical.productId,
      appId: item.appId ?? canonical.appId,
      productType: item.productType ?? canonical.productType
    };
  });
}

export function dedupeLibraryItems(items: LibraryItem[]): LibraryItem[] {
  const groups = new Map<string, LibraryItem[]>();

  for (const item of items) {
    const key =
      item.productId !== undefined
        ? `product:${item.productId}`
        : `title:${normalizeForMatch(item.title)}`;
    const group = groups.get(key) ?? [];
    group.push(item);
    groups.set(key, group);
  }

  return [...groups.values()]
    .map((group) => {
      const sorted = [...group].sort(compareLibraryItems);
      const canonical = sorted[0] ?? group[0];
      const releaseDate =
        canonical.releaseDate ??
        group.find((item) => item.releaseDate)?.releaseDate;

      return {
        ...canonical,
        releaseDate,
        variantCount: group.length,
        variantSpaceIds: group.map((item) => item.spaceId)
      } satisfies LibraryItem;
    })
    .sort((a, b) => a.title.localeCompare(b.title));
}

export class LibraryService {
  private readonly authService: AuthService;
  private readonly httpClient: HttpClient;

  public constructor(
    paths: AppPaths,
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly publicCatalog: PublicCatalogService,
    authService?: AuthService,
    httpClient?: HttpClient
  ) {
    this.authService =
      authService ?? new AuthService(paths, config, logger.child('auth'));
    this.httpClient =
      httpClient ?? new HttpClient(config, logger.child('graphql'));
  }

  public async listOwnedGames(
    options: ListOwnedGamesOptions = {}
  ): Promise<LibraryItem[]> {
    const session = await this.authService.ensureValidSession();
    const nodes = await this.fetchAllGraphqlGames(
      session.ticket,
      session.sessionId
    );

    const items = await Promise.all(
      nodes.map(async (node) => {
        const catalogMatch =
          (await this.publicCatalog.findCatalogProductBySpaceId(
            node.spaceId
          )) ??
          (await this.publicCatalog.findUniqueCatalogProductByTitle(node.name));

        return {
          title: node.name,
          spaceId: node.spaceId,
          productId: catalogMatch?.productId,
          appId: catalogMatch?.appId,
          productType: catalogMatch?.productType,
          coverUrl: node.coverUrl,
          backgroundUrl: node.backgroundUrl,
          bannerUrl: node.bannerUrl,
          releaseDate: node.releaseDate,
          source: 'graphql'
        } satisfies LibraryItem;
      })
    );

    const normalized = propagateKnownMetadataByTitle(items);
    if (options.dedupe ?? false) {
      return dedupeLibraryItems(normalized);
    }

    return normalized.sort((a, b) => a.title.localeCompare(b.title));
  }

  private async fetchAllGraphqlGames(
    ticket: string,
    sessionId: string
  ): Promise<GraphqlGameNode[]> {
    const pageSize = 50;
    const nodes: GraphqlGameNode[] = [];
    let offset = 0;
    let totalCount: number | undefined;

    while (true) {
      const response = await this.httpClient.requestJson<GraphqlGamesPage>(
        'https://public-ubiservices.ubi.com/v1/profiles/me/uplay/graphql',
        {
          method: 'POST',
          headers: {
            Authorization: `Ubi_v1 t=${ticket}`,
            'Content-Type': 'application/json',
            'Ubi-AppId': this.config.servicesAppId,
            'Ubi-RequestedPlatformType': this.config.requestedPlatformType,
            'Ubi-SessionId': sessionId,
            'User-Agent':
              'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
          },
          body: {
            operationName: 'OwnedGames',
            query: GRAPHQL_QUERY,
            variables: {
              limit: pageSize,
              offset
            }
          }
        }
      );

      if (response.data.errors?.length) {
        throw new Error(
          response.data.errors[0]?.message ??
            'Ubisoft GraphQL returned an error.'
        );
      }

      const page = response.data.data?.viewer?.games;
      const pageNodes = page?.nodes ?? [];
      totalCount = page?.totalCount ?? totalCount;
      nodes.push(...pageNodes);
      this.logger.debug('fetched library page', {
        offset,
        received: pageNodes.length,
        totalCount
      });

      if (pageNodes.length < pageSize) {
        break;
      }

      offset += pageNodes.length;
      if (totalCount !== undefined && nodes.length >= totalCount) {
        break;
      }
    }

    return nodes;
  }
}
