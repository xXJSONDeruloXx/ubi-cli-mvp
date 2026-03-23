export interface LibraryItem {
  title: string;
  spaceId: string;
  productId?: number;
  appId?: string;
  productType?: string;
  coverUrl?: string;
  backgroundUrl?: string;
  bannerUrl?: string;
  releaseDate?: string;
  source: 'graphql';
  variantCount?: number;
  variantSpaceIds?: string[];
}
