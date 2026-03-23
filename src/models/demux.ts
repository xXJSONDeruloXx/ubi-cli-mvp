import type { ProductConfigSummary } from './product';

export interface DemuxBranch {
  branchId: number;
  branchName: string;
  active: boolean;
}

export interface DemuxOwnedGame {
  title: string;
  demuxProductId: number;
  publicProductId?: number;
  spaceId?: string;
  appId?: string;
  latestManifest?: string;
  owned: boolean;
  state: number;
  productType: number;
  gameCode?: string;
  configSummary?: ProductConfigSummary;
  productAssociations: number[];
  branches: DemuxBranch[];
  activeBranchId?: number;
  hasDownloadManifest: boolean;
  hasConfiguration: boolean;
}

export interface DemuxDownloadUrl {
  relativePath: string;
  result: number;
  urls: string[];
}

export interface DemuxDownloadUrlsInfo {
  title: string;
  demuxProductId: number;
  publicProductId?: number;
  manifestHash: string;
  ownershipTokenExpiresAt?: string;
  manifestUrl?: string;
  metadataUrl?: string;
  licensesUrl?: string;
  urls: DemuxDownloadUrl[];
  notes: string[];
}

export interface DemuxSliceUrlsInfo {
  title: string;
  demuxProductId: number;
  publicProductId?: number;
  manifestHash: string;
  totalUniqueSliceCount: number;
  requestedSliceCount: number;
  ownershipTokenExpiresAt?: string;
  urls: DemuxDownloadUrl[];
  notes: string[];
}

export interface DemuxSliceDownload {
  relativePath: string;
  filePath: string;
  bytes: number;
  url: string;
}

export interface DemuxSliceDownloadResult {
  title: string;
  demuxProductId: number;
  publicProductId?: number;
  manifestHash: string;
  outputDir: string;
  downloadedCount: number;
  files: DemuxSliceDownload[];
  notes: string[];
}

export interface DemuxExtractedFileResult {
  title: string;
  demuxProductId: number;
  publicProductId?: number;
  manifestHash: string;
  manifestPath: string;
  outputPath: string;
  sliceCount: number;
  bytesDownloaded: number;
  bytesWritten: number;
  notes: string[];
}

export interface DemuxExtractedFilesItem {
  manifestPath: string;
  outputPath: string;
  sliceCount: number;
  bytesWritten: number;
}

export interface DemuxExtractedFilesResult {
  title: string;
  demuxProductId: number;
  publicProductId?: number;
  manifestHash: string;
  outputDir: string;
  matchedCount: number;
  extractedCount: number;
  sliceReferenceCount: number;
  uniqueSliceCount: number;
  bytesDownloaded: number;
  bytesWritten: number;
  files: DemuxExtractedFilesItem[];
  notes: string[];
}

export interface LiveManifestDownload {
  game: DemuxOwnedGame;
  manifestHash: string;
  manifestUrl: string;
  metadataUrl?: string;
  licensesUrl?: string;
  body: Buffer;
  metadataBody?: Buffer;
  licensesBody?: Buffer;
  notes: string[];
}
