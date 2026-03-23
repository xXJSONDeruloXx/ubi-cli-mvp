export interface ProductConfigSummary {
  rootName?: string;
  publisher?: string;
  helpUrl?: string;
  gameCode?: string;
  configurationVersion?: number;
}

export interface ProductInfo {
  query: string;
  title: string;
  productId?: number;
  spaceId?: string;
  appId?: string;
  productType?: string;
  manifestHashes: string[];
  configSummary?: ProductConfigSummary;
  hasRawConfiguration: boolean;
  sources: {
    library: boolean;
    publicCatalog: boolean;
  };
}
