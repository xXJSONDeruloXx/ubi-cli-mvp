import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { HttpClient } from '../core/http';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type { Logger } from '../util/logger';
import { normalizeForMatch } from '../util/matching';

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

export interface CatalogProductMatch {
  productId: number;
  title?: string;
  spaceId?: string;
  appId?: string;
  productType?: string;
  productAssociations?: number[];
}

interface CatalogCache<T> {
  fetchedAt: string;
  data: T;
}

interface ParsedConfigurationIndexEntry {
  productId: number;
  title?: string;
  spaceId?: string;
  appId?: string;
}

interface ParsedConfiguration {
  root?: {
    name?: string;
    space_id?: string;
    app_id?: string;
  };
  localizations?: {
    default?: Record<string, string | null>;
    'en-US'?: Record<string, string | null>;
    'en-CA'?: Record<string, string | null>;
  };
}

const RAW_BASE =
  'https://raw.githubusercontent.com/UplayDB/UplayManifests/main';

export class PublicCatalogService {
  private readonly httpClient: HttpClient;
  private parsedConfigIndexPromise?: Promise<ParsedConfigurationIndexEntry[]>;

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

  public async findCatalogProductBySpaceId(
    spaceId: string
  ): Promise<CatalogProductMatch | undefined> {
    const serviceEntry = await this.findProductServiceBySpaceId(spaceId);
    if (serviceEntry) {
      const game = await this.findGameByProductId(serviceEntry.ProductId);
      return {
        productId: serviceEntry.ProductId,
        spaceId: serviceEntry.SpaceId,
        appId: serviceEntry.AppId,
        productType: game?.ProductType,
        productAssociations: game?.ProductAssociations
      };
    }

    const configIndex = await this.getParsedConfigurationIndex();
    const configEntry = configIndex.find((entry) => entry.spaceId === spaceId);
    if (!configEntry) {
      return undefined;
    }

    const game = await this.findGameByProductId(configEntry.productId);
    return {
      productId: configEntry.productId,
      title: configEntry.title,
      spaceId: configEntry.spaceId,
      appId: configEntry.appId,
      productType: game?.ProductType,
      productAssociations: game?.ProductAssociations
    };
  }

  public async findUniqueCatalogProductByTitle(
    title: string
  ): Promise<CatalogProductMatch | undefined> {
    const matches = await this.findCatalogProductsByTitle(title, 'exact');
    const uniqueProductIds = [
      ...new Set(matches.map((entry) => entry.productId))
    ];
    if (uniqueProductIds.length !== 1) {
      return undefined;
    }

    return matches.find((entry) => entry.productId === uniqueProductIds[0]);
  }

  public async findCatalogProductsByTitle(
    title: string,
    mode: 'exact' | 'includes' = 'includes'
  ): Promise<CatalogProductMatch[]> {
    const normalizedTitle = normalizeForMatch(title);
    const configIndex = await this.getParsedConfigurationIndex();
    const matchedEntries = configIndex.filter((entry) => {
      if (entry.title === undefined) {
        return false;
      }

      const normalizedEntryTitle = normalizeForMatch(entry.title);
      return mode === 'exact'
        ? normalizedEntryTitle === normalizedTitle
        : normalizedEntryTitle.includes(normalizedTitle);
    });

    const uniqueProductIds = [
      ...new Set(matchedEntries.map((entry) => entry.productId))
    ];
    const described = await Promise.all(
      uniqueProductIds.map((productId) =>
        this.describeCatalogProductById(productId)
      )
    );

    return described.filter(
      (entry): entry is CatalogProductMatch => entry !== undefined
    );
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

  public async describeCatalogProductById(
    productId: number
  ): Promise<CatalogProductMatch | undefined> {
    const [game, serviceEntry, configIndex] = await Promise.all([
      this.findGameByProductId(productId),
      this.getProductService().then((entries) =>
        entries.find((entry) => entry.ProductId === productId)
      ),
      this.getParsedConfigurationIndex()
    ]);
    const configEntry = configIndex.find(
      (entry) => entry.productId === productId
    );

    if (!game && !serviceEntry && !configEntry) {
      return undefined;
    }

    return {
      productId,
      title: configEntry?.title,
      spaceId: serviceEntry?.SpaceId ?? configEntry?.spaceId,
      appId: serviceEntry?.AppId ?? configEntry?.appId,
      productType: game?.ProductType,
      productAssociations: game?.ProductAssociations
    };
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

  private async getParsedConfigurationIndex(): Promise<
    ParsedConfigurationIndexEntry[]
  > {
    if (!this.parsedConfigIndexPromise) {
      this.parsedConfigIndexPromise = this.buildParsedConfigurationIndex();
    }

    return this.parsedConfigIndexPromise;
  }

  private async buildParsedConfigurationIndex(): Promise<
    ParsedConfigurationIndexEntry[]
  > {
    const entries = await this.getProductConfig();
    const index: ParsedConfigurationIndexEntry[] = [];

    for (const entry of entries) {
      try {
        const parsed = YAML.parse(entry.Configuration) as ParsedConfiguration;
        const rawTitle = parsed.root?.name;
        const localizedTitle =
          typeof rawTitle === 'string'
            ? (parsed.localizations?.default?.[rawTitle] ??
              parsed.localizations?.['en-US']?.[rawTitle] ??
              parsed.localizations?.['en-CA']?.[rawTitle] ??
              rawTitle)
            : undefined;

        index.push({
          productId: entry.ProductId,
          title:
            typeof localizedTitle === 'string' ? localizedTitle : undefined,
          spaceId: parsed.root?.space_id,
          appId: parsed.root?.app_id
        });
      } catch {
        // Some public configuration blobs are malformed YAML; skip them.
      }
    }

    return index;
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
