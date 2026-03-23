import type { AddonInfo } from '../models/addon';
import type { ProductService } from './product-service';
import type { PublicCatalogService } from './public-catalog-service';

export class AddonService {
  public constructor(
    private readonly productService: ProductService,
    private readonly publicCatalog: PublicCatalogService
  ) {}

  public async listAssociatedProducts(query: string): Promise<AddonInfo[]> {
    const resolved = await this.productService.resolveProduct(query);
    if (!resolved.info.productId) {
      return [];
    }

    const game = await this.publicCatalog.findGameByProductId(
      resolved.info.productId
    );
    const productAssociations = game?.ProductAssociations ?? [];

    const addons = await Promise.all(
      productAssociations.map(async (productId) => {
        const described =
          await this.publicCatalog.describeCatalogProductById(productId);
        const manifestHashes =
          await this.publicCatalog.findManifestsByProductId(productId);

        return {
          productId,
          title: described?.title,
          productType: described?.productType,
          manifestHashes
        } satisfies AddonInfo;
      })
    );

    return addons.sort((a, b) => a.productId - b.productId);
  }
}
