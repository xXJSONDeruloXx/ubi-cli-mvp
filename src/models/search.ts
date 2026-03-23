export interface SearchResult {
  title: string;
  productId?: number;
  productType?: string;
  source: 'library' | 'catalog';
  owned: boolean;
  spaceId?: string;
  appId?: string;
}
