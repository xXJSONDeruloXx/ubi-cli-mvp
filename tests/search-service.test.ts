import { describe, expect, it } from 'vitest';
import { SearchService } from '../src/services/search-service';

describe('search service', () => {
  it('merges owned library and public catalog matches', async () => {
    const libraryService = {
      listOwnedGames: () =>
        Promise.resolve([
          {
            title: "Assassin's Creed® Unity",
            productId: 720,
            productType: 'Game',
            source: 'graphql' as const,
            spaceId: 'space-720'
          }
        ])
    };
    const publicCatalog = {
      findCatalogProductsByTitle: () =>
        Promise.resolve([
          {
            productId: 720,
            title: "Assassin's Creed® Unity",
            productType: 'Game'
          },
          {
            productId: 1019,
            title: 'Assassin’s Creed® Unity - Dead Kings',
            productType: 'DLC'
          }
        ])
    };

    const service = new SearchService(
      libraryService as never,
      publicCatalog as never
    );
    const results = await service.search('unity');

    expect(results).toEqual([
      {
        title: "Assassin's Creed® Unity",
        productId: 720,
        productType: 'Game',
        source: 'library',
        owned: true,
        spaceId: 'space-720',
        appId: undefined
      },
      {
        title: 'Assassin’s Creed® Unity - Dead Kings',
        productId: 1019,
        productType: 'DLC',
        source: 'catalog',
        owned: false,
        spaceId: undefined,
        appId: undefined
      }
    ]);
  });
});
