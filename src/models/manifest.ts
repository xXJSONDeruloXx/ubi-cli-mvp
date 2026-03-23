export interface ParsedManifestSummary {
  manifestHash: string;
  version?: number;
  compressionMethod?: number;
  isCompressed?: boolean;
  patchRequired?: boolean;
  languageCodes: string[];
  chunkCount: number;
  fileCount: number;
}

export interface ManifestInfo {
  title: string;
  productId?: number;
  manifestHashes: string[];
  selectedManifestHash?: string;
  parsedManifest?: ParsedManifestSummary;
  rawFixtureUrl?: string;
  status: 'parsed-public-fixture' | 'hashes-only' | 'blocked';
  notes: string[];
}
