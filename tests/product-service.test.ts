import { describe, expect, it } from 'vitest';
import { ProductService } from '../src/services/product-service';

describe('product service resolution', () => {
  it('falls back to a unique public catalog title match when the title is not owned', async () => {
    const libraryService = {
      listOwnedGames: () => Promise.resolve([])
    };

    const publicCatalog = {
      findUniqueCatalogProductByTitle: (query: string) =>
        Promise.resolve(
          query === 'Far Cry® 3'
            ? {
                productId: 46,
                title: 'Far Cry® 3',
                spaceId: 'space-46',
                appId: 'app-46',
                productType: 'Game'
              }
            : undefined
        ),
      findConfigByProductId: () =>
        Promise.resolve({
          ProductId: 46,
          Configuration: `version: 2.0\nroot:\n  name: Far Cry® 3\n  installer:\n    publisher: Ubisoft\n  uplay:\n    game_code: FC3\n`
        }),
      findManifestsByProductId: () => Promise.resolve(['manifest-46'])
    };

    const service = new ProductService(
      libraryService as never,
      publicCatalog as never
    );
    const { info } = await service.resolveProduct('Far Cry® 3');

    expect(info).toMatchObject({
      title: 'Far Cry® 3',
      productId: 46,
      appId: 'app-46',
      productType: 'Game',
      sources: {
        library: false,
        publicCatalog: true
      }
    });
    expect(info.manifestHashes).toEqual(['manifest-46']);
  });
});
