import type { SearchResult } from '../models/search';
import { normalizeForMatch } from '../util/matching';
import type { LibraryService } from './library-service';
import type { PublicCatalogService } from './public-catalog-service';

export class SearchService {
  public constructor(
    private readonly libraryService: LibraryService,
    private readonly publicCatalog: PublicCatalogService
  ) {}

  public async search(query: string, limit = 25): Promise<SearchResult[]> {
    const [libraryItems, catalogItems] = await Promise.all([
      this.libraryService.listOwnedGames({ dedupe: true }),
      this.publicCatalog.findCatalogProductsByTitle(query)
    ]);

    const results = new Map<string, SearchResult>();
    for (const item of libraryItems) {
      if (!normalizeForMatch(item.title).includes(normalizeForMatch(query))) {
        continue;
      }

      const key =
        item.productId !== undefined
          ? `product:${item.productId}`
          : `library:${item.spaceId}`;
      results.set(key, {
        title: item.title,
        productId: item.productId,
        productType: item.productType,
        source: 'library',
        owned: true,
        spaceId: item.spaceId,
        appId: item.appId
      });
    }

    for (const item of catalogItems) {
      const key =
        item.productId !== undefined
          ? `product:${item.productId}`
          : `catalog:${item.spaceId ?? item.title}`;
      if (results.has(key)) {
        continue;
      }

      results.set(key, {
        title: item.title ?? `Product ${item.productId}`,
        productId: item.productId,
        productType: item.productType,
        source: 'catalog',
        owned: false,
        spaceId: item.spaceId,
        appId: item.appId
      });
    }

    return [...results.values()]
      .sort((a, b) => {
        if (a.owned !== b.owned) {
          return a.owned ? -1 : 1;
        }

        return a.title.localeCompare(b.title);
      })
      .slice(0, limit);
  }
}
