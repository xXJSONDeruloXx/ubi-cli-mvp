import YAML from 'yaml';
import type { LibraryItem } from '../models/library';
import type { ProductConfigSummary, ProductInfo } from '../models/product';
import { UserFacingError } from '../util/errors';
import { isLikelyNumericId, scoreTitleMatch } from '../util/matching';
import type { LibraryService } from './library-service';
import type {
  ProductConfigEntry,
  ProductServiceEntry,
  PublicCatalogService
} from './public-catalog-service';

export interface ResolvedProduct {
  info: ProductInfo;
  libraryItem?: LibraryItem;
  productServiceEntry?: ProductServiceEntry;
  productConfigEntry?: ProductConfigEntry;
}

export class ProductService {
  public constructor(
    private readonly libraryService: LibraryService,
    private readonly publicCatalog: PublicCatalogService
  ) {}

  public async resolveProduct(query: string): Promise<ResolvedProduct> {
    const library = await this.libraryService.listOwnedGames();

    if (isLikelyNumericId(query)) {
      const productId = Number.parseInt(query, 10);
      const libraryItem = library.find((item) => item.productId === productId);
      const productServiceEntry = libraryItem?.spaceId
        ? await this.publicCatalog.findProductServiceBySpaceId(
            libraryItem.spaceId
          )
        : (await this.publicCatalog.getProductService()).find(
            (entry) => entry.ProductId === productId
          );
      const productConfigEntry =
        await this.publicCatalog.findConfigByProductId(productId);
      const game = await this.publicCatalog.findGameByProductId(productId);
      const manifestHashes =
        await this.publicCatalog.findManifestsByProductId(productId);

      if (
        !libraryItem &&
        !productServiceEntry &&
        !productConfigEntry &&
        !game
      ) {
        throw new UserFacingError(`No Ubisoft product matched ID ${query}.`);
      }

      return {
        info: {
          query,
          title:
            libraryItem?.title ??
            this.getConfigSummary(productConfigEntry?.Configuration)
              ?.rootName ??
            `Product ${productId}`,
          productId,
          spaceId: libraryItem?.spaceId ?? productServiceEntry?.SpaceId,
          appId: libraryItem?.appId ?? productServiceEntry?.AppId,
          productType: libraryItem?.productType ?? game?.ProductType,
          manifestHashes,
          configSummary: this.getConfigSummary(
            productConfigEntry?.Configuration
          ),
          hasRawConfiguration: Boolean(productConfigEntry?.Configuration),
          sources: {
            library: Boolean(libraryItem),
            publicCatalog: true
          }
        },
        libraryItem,
        productServiceEntry,
        productConfigEntry
      };
    }

    const scoredLibraryMatches = library
      .map((item) => ({ item, score: scoreTitleMatch(query, item.title) }))
      .filter((match) => match.score > 0)
      .sort((a, b) => b.score - a.score);

    const libraryItem = scoredLibraryMatches[0]?.item;
    if (!libraryItem) {
      throw new UserFacingError(
        `No owned Ubisoft title matched "${query}". Try a product ID or exact title from \`ubi list\`.`
      );
    }

    const productServiceEntry =
      await this.publicCatalog.findProductServiceBySpaceId(libraryItem.spaceId);
    const productConfigEntry = libraryItem.productId
      ? await this.publicCatalog.findConfigByProductId(libraryItem.productId)
      : undefined;
    const manifestHashes = libraryItem.productId
      ? await this.publicCatalog.findManifestsByProductId(libraryItem.productId)
      : [];

    return {
      info: {
        query,
        title: libraryItem.title,
        productId: libraryItem.productId,
        spaceId: libraryItem.spaceId,
        appId: libraryItem.appId ?? productServiceEntry?.AppId,
        productType: libraryItem.productType,
        manifestHashes,
        configSummary: this.getConfigSummary(productConfigEntry?.Configuration),
        hasRawConfiguration: Boolean(productConfigEntry?.Configuration),
        sources: {
          library: true,
          publicCatalog: Boolean(productServiceEntry || productConfigEntry)
        }
      },
      libraryItem,
      productServiceEntry,
      productConfigEntry
    };
  }

  private getConfigSummary(
    configuration?: string
  ): ProductConfigSummary | undefined {
    if (!configuration) {
      return undefined;
    }

    const parsed = YAML.parse(configuration) as {
      version?: number;
      root?: {
        name?: string;
        installer?: {
          publisher?: string;
          help_url?: string;
        };
        uplay?: {
          game_code?: string;
        };
      };
    };

    return {
      rootName: parsed.root?.name,
      publisher: parsed.root?.installer?.publisher,
      helpUrl: parsed.root?.installer?.help_url,
      gameCode: parsed.root?.uplay?.game_code,
      configurationVersion: parsed.version
    };
  }
}
