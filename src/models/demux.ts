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
  urls: DemuxDownloadUrl[];
  notes: string[];
}

export interface LiveManifestDownload {
  game: DemuxOwnedGame;
  manifestHash: string;
  manifestUrl: string;
  metadataUrl?: string;
  licensesUrl?: string;
  body: Buffer;
}
