import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type { Logger } from '../util/logger';
import { HttpClient } from '../core/http';

export interface GameListEntry {
  ProductId: number;
  ProductType: string;
  ProductAssociations: number[];
}

export interface ManifestListEntry {
  ProductId: number;
  Manifest: string[];
}

export interface ProductServiceEntry {
  ProductId: number;
  SpaceId: string;
  AppId: string;
}

export interface ProductConfigEntry {
  ProductId: number;
  Configuration: string;
}

interface CatalogCache<T> {
  fetchedAt: string;
  data: T;
}

const RAW_BASE =
  'https://raw.githubusercontent.com/UplayDB/UplayManifests/main';

export class PublicCatalogService {
  private readonly httpClient: HttpClient;

  public constructor(
    private readonly paths: AppPaths,
    config: RuntimeConfig,
    logger: Logger,
    httpClient?: HttpClient
  ) {
    this.httpClient =
      httpClient ?? new HttpClient(config, logger.child('public-catalog'));
  }

  public async getGameList(): Promise<GameListEntry[]> {
    return this.loadDataset<GameListEntry[]>('gamelist.json');
  }

  public async getManifestList(): Promise<ManifestListEntry[]> {
    return this.loadDataset<ManifestListEntry[]>('manifestlist.json');
  }

  public async getProductService(): Promise<ProductServiceEntry[]> {
    return this.loadDataset<ProductServiceEntry[]>('productservice.json');
  }

  public async getProductConfig(): Promise<ProductConfigEntry[]> {
    return this.loadDataset<ProductConfigEntry[]>('productconfig.json');
  }

  public async findProductServiceBySpaceId(
    spaceId: string
  ): Promise<ProductServiceEntry | undefined> {
    const entries = await this.getProductService();
    return entries.find((entry) => entry.SpaceId === spaceId);
  }

  public async findManifestsByProductId(productId: number): Promise<string[]> {
    const entries = await this.getManifestList();
    return (
      entries.find((entry) => entry.ProductId === productId)?.Manifest ?? []
    );
  }

  public async findGameByProductId(
    productId: number
  ): Promise<GameListEntry | undefined> {
    const entries = await this.getGameList();
    return entries.find((entry) => entry.ProductId === productId);
  }

  public async findConfigByProductId(
    productId: number
  ): Promise<ProductConfigEntry | undefined> {
    const entries = await this.getProductConfig();
    return entries.find((entry) => entry.ProductId === productId);
  }

  public getPublicManifestFixtureUrl(
    productId: number,
    manifestHash: string
  ): string {
    return `${RAW_BASE}/files/${productId}_${manifestHash}.manifest`;
  }

  public getPublicManifestTextUrl(
    productId: number,
    manifestHash: string
  ): string {
    return `${RAW_BASE}/files/${productId}_${manifestHash}.txt`;
  }

  private async loadDataset<T>(fileName: string): Promise<T> {
    const cacheFile = path.join(this.paths.cacheDir, fileName);

    try {
      const raw = await readFile(cacheFile, 'utf8');
      const cached = JSON.parse(raw) as CatalogCache<T>;
      return cached.data;
    } catch {
      // Cache miss, fetch live below.
    }

    const response = await this.httpClient.requestJson<T>(
      `${RAW_BASE}/${fileName}`
    );
    if (!(response.status >= 200 && response.status < 300)) {
      throw new Error(`Failed to fetch ${fileName}: HTTP ${response.status}`);
    }

    const payload: CatalogCache<T> = {
      fetchedAt: new Date().toISOString(),
      data: response.data
    };

    await writeFile(cacheFile, JSON.stringify(payload, null, 2));
    return response.data;
  }
}
