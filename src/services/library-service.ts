import type { AppPaths, RuntimeConfig } from '../models/config';
import type { LibraryItem } from '../models/library';
import type { Logger } from '../util/logger';
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

  public async listOwnedGames(): Promise<LibraryItem[]> {
    const session = await this.authService.ensureValidSession();
    const nodes = await this.fetchAllGraphqlGames(
      session.ticket,
      session.sessionId
    );

    const items = await Promise.all(
      nodes.map(async (node) => {
        const publicEntry =
          await this.publicCatalog.findProductServiceBySpaceId(node.spaceId);
        const game = publicEntry
          ? await this.publicCatalog.findGameByProductId(publicEntry.ProductId)
          : undefined;

        return {
          title: node.name,
          spaceId: node.spaceId,
          productId: publicEntry?.ProductId,
          appId: publicEntry?.AppId,
          productType: game?.ProductType,
          coverUrl: node.coverUrl,
          backgroundUrl: node.backgroundUrl,
          bannerUrl: node.bannerUrl,
          releaseDate: node.releaseDate,
          source: 'graphql'
        } satisfies LibraryItem;
      })
    );

    return items.sort((a, b) => a.title.localeCompare(b.title));
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
