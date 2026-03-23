import { describe, expect, it } from 'vitest';
import { AddonService } from '../src/services/addon-service';

describe('addon service', () => {
  it('lists associated products for a resolved title', async () => {
    const productService = {
      resolveProduct: () =>
        Promise.resolve({
          info: {
            productId: 720
          }
        })
    };

    const publicCatalog = {
      findGameByProductId: () =>
        Promise.resolve({
          ProductId: 720,
          ProductType: 'Game',
          ProductAssociations: [1018, 1019]
        }),
      describeCatalogProductById: (productId: number) =>
        Promise.resolve({
          productId,
          title: productId === 1018 ? 'Season Pass' : 'Dead Kings',
          productType: 'DLC'
        }),
      findManifestsByProductId: (productId: number) =>
        Promise.resolve(productId === 1018 ? ['m1'] : [])
    };

    const service = new AddonService(
      productService as never,
      publicCatalog as never
    );
    const addons = await service.listAssociatedProducts('720');

    expect(addons).toEqual([
      {
        productId: 1018,
        title: 'Season Pass',
        productType: 'DLC',
        manifestHashes: ['m1']
      },
      {
        productId: 1019,
        title: 'Dead Kings',
        productType: 'DLC',
        manifestHashes: []
      }
    ]);
  });
});
