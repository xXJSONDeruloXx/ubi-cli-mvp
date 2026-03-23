export interface ManifestFileEntry {
  path: string;
  installBytes: string;
  downloadBytes: string;
  sliceCount: number;
  isDirectory: boolean;
}

export interface ParsedManifestSummary {
  manifestHash: string;
  version?: number;
  compressionMethod?: number;
  isCompressed?: boolean;
  patchRequired?: boolean;
  languageCodes: string[];
  chunkCount: number;
  fileCount: number;
  installBytes?: string;
  downloadBytes?: string;
}

export interface ManifestInfo {
  title: string;
  productId?: number;
  manifestHashes: string[];
  selectedManifestHash?: string;
  parsedManifest?: ParsedManifestSummary;
  rawFixtureUrl?: string;
  rawSourceUrl?: string;
  metadataUrl?: string;
  licensesUrl?: string;
  status:
    | 'parsed-public-fixture'
    | 'parsed-live-demux'
    | 'hashes-only'
    | 'blocked';
  notes: string[];
}

export interface DownloadPlan {
  title: string;
  productId?: number;
  selectedManifestHash?: string;
  status: ManifestInfo['status'];
  installBytes?: string;
  downloadBytes?: string;
  chunkCount?: number;
  fileCount?: number;
  largestFiles: ManifestFileEntry[];
  notes: string[];
}
