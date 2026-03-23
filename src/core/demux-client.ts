import type tls from 'node:tls';
import type { RuntimeConfig } from '../models/config';
import type { Logger } from '../util/logger';
import type { StoredSession } from './session-store';
import { loadUbisoftDemuxModule } from './ubisoft-demux-loader';

interface DemuxPatchInfoResponse {
  getPatchInfoRsp?: {
    success?: boolean;
    latestVersion?: number;
    patchBaseUrl?: string;
  };
}

interface DemuxAuthenticateResponse {
  authenticateRsp?: {
    success?: boolean;
  };
}

interface DemuxOwnedGamePayload {
  productId: number;
  owned: boolean;
  state: number;
  productType: number;
  productAssociations?: number[];
  configuration?: string;
  gameCode?: string;
  activeBranchId?: number;
  availableBranches?: Array<{
    branchId: number;
    branchName: string;
  }>;
  ubiservicesSpaceId?: string;
  ubiservicesAppId?: string;
  latestManifest?: string;
}

interface DemuxOwnershipInitializeResponse {
  response?: {
    initializeRsp?: {
      success?: boolean;
      ownedGames?: {
        ownedGames?: DemuxOwnedGamePayload[];
      };
    };
  };
}

interface DemuxOwnershipTokenResponse {
  response?: {
    ownershipTokenRsp?: {
      token?: string;
      expiration?: number | { toString(): string };
    };
  };
}

interface DemuxProductConfigResponse {
  response?: {
    getProductConfigRsp?: {
      configuration?: string;
    };
  };
}

interface DemuxDownloadInitializeResponse {
  response?: {
    initializeRsp?: {
      ok?: boolean;
    };
  };
}

interface DemuxDownloadUrlResponse {
  response?: {
    urlRsp?: {
      urlResponses?: Array<{
        result?: number;
        relativeFilePath?: string;
        downloadUrls?: Array<{
          urls?: string[];
        }>;
      }>;
    };
  };
}

interface DemuxConnectionLike {
  connectionId: number;
  request(payload: unknown): Promise<unknown>;
}

interface DemuxSocketLike {
  push(payload: unknown): Promise<void>;
}

interface UbisoftDemuxLike {
  socket: DemuxSocketLike;
  basicRequest(payload: unknown): Promise<unknown>;
  openConnection(
    serviceName: 'ownership_service' | 'download_service'
  ): Promise<DemuxConnectionLike>;
  destroy(): Promise<void>;
}

interface UbisoftDemuxModuleLike {
  UbisoftDemux: new (props?: {
    timeout?: number;
    tlsConnectionOptions?: tls.ConnectionOptions;
  }) => UbisoftDemuxLike;
}

export interface DemuxDownloadUrlResult {
  result: number;
  relativePath: string;
  urls: string[];
}

export interface DownloadUrlResult {
  ownershipTokenExpiresAt?: string;
  responses: DemuxDownloadUrlResult[];
}

export interface ManifestAssetUrlResult extends DownloadUrlResult {
  manifestUrl?: string;
  metadataUrl?: string;
  licensesUrl?: string;
}

export interface DemuxClientOptions {
  moduleLoader?: () => Promise<UbisoftDemuxModuleLike>;
}

function expirationToString(
  value: number | { toString(): string } | undefined
): string | undefined {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'number' ? String(value) : value.toString();
}

function normalizeUrlPathname(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url.split('?')[0] ?? url;
  }
}

function findAssetUrl(
  responses: DemuxDownloadUrlResult[],
  suffix: '.manifest' | '.metadata' | '.licenses'
): string | undefined {
  for (const response of responses) {
    const directMatch = response.urls.find((url) =>
      normalizeUrlPathname(url).endsWith(suffix)
    );
    if (directMatch) {
      return directMatch;
    }

    if (response.relativePath.endsWith(suffix) && response.urls[0]) {
      return response.urls[0];
    }
  }

  return undefined;
}

export class DemuxClient {
  private readonly moduleLoader: () => Promise<UbisoftDemuxModuleLike>;
  private demux?: UbisoftDemuxLike;
  private authenticatedTicket?: string;
  private ownershipConnection?: DemuxConnectionLike;
  private ownershipInitializedSessionId?: string;
  private cachedOwnedGames?: DemuxOwnedGamePayload[];

  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    options: DemuxClientOptions = {}
  ) {
    this.moduleLoader = options.moduleLoader ?? loadUbisoftDemuxModule;
  }

  public async getPatchInfo(): Promise<
    DemuxPatchInfoResponse['getPatchInfoRsp']
  > {
    return this.withRetry('getPatchInfo', async () => {
      const demux = await this.getDemux();
      const patch = (await demux.basicRequest({
        getPatchInfoReq: {
          patchTrackId: 'DEFAULT',
          testConfig: false,
          trackType: 0
        }
      })) as DemuxPatchInfoResponse;

      return patch.getPatchInfoRsp;
    });
  }

  public async listOwnedGames(
    session: StoredSession
  ): Promise<DemuxOwnedGamePayload[]> {
    return this.withRetry('listOwnedGames', async () => {
      await this.initializeOwnership(session);
      return this.cachedOwnedGames ?? [];
    });
  }

  public async getProductConfig(
    session: StoredSession,
    productId: number
  ): Promise<string | undefined> {
    return this.withRetry(`getProductConfig:${productId}`, async () => {
      await this.initializeOwnership(session);
      const ownership = await this.getOwnershipConnection(session);
      const response = (await ownership.request({
        request: {
          requestId: 1,
          getProductConfigReq: {
            productId,
            deprecatedTestConfig: false
          },
          ubiTicket: session.ticket,
          ubiSessionId: session.sessionId
        }
      })) as DemuxProductConfigResponse;

      return response.response?.getProductConfigRsp?.configuration;
    });
  }

  public async getOwnershipToken(
    session: StoredSession,
    productId: number
  ): Promise<{ token?: string; expiration?: string }> {
    return this.withRetry(`getOwnershipToken:${productId}`, async () => {
      await this.initializeOwnership(session);
      const ownership = await this.getOwnershipConnection(session);
      const response = (await ownership.request({
        request: {
          requestId: 1,
          ownershipTokenReq: {
            productId
          },
          ubiTicket: session.ticket,
          ubiSessionId: session.sessionId
        }
      })) as DemuxOwnershipTokenResponse;

      return {
        token: response.response?.ownershipTokenRsp?.token,
        expiration: expirationToString(
          response.response?.ownershipTokenRsp?.expiration
        )
      };
    });
  }

  public async getDownloadUrlsForRelativePaths(
    session: StoredSession,
    productId: number,
    relativePaths: string[]
  ): Promise<DownloadUrlResult> {
    return this.withRetry(
      `getDownloadUrlsForRelativePaths:${productId}`,
      async () => {
        const token = await this.getOwnershipToken(session, productId);
        if (!token.token) {
          throw new Error(
            `Demux did not return an ownership token for product ${productId}.`
          );
        }

        const demux = await this.getAuthenticatedDemux(session);
        const downloadConnection =
          await demux.openConnection('download_service');
        const initializeResponse = (await downloadConnection.request({
          request: {
            requestId: 1,
            initializeReq: {
              ownershipToken: token.token,
              networkId: ''
            }
          }
        })) as DemuxDownloadInitializeResponse;

        if (!initializeResponse.response?.initializeRsp?.ok) {
          throw new Error(
            `Demux download service initialization failed for product ${productId}.`
          );
        }

        const urlResponse = (await downloadConnection.request({
          request: {
            requestId: 1,
            urlReq: {
              urlRequests: [
                {
                  productId,
                  relativeFilePath: relativePaths
                }
              ]
            }
          }
        })) as DemuxDownloadUrlResponse;

        return {
          ownershipTokenExpiresAt: token.expiration,
          responses:
            urlResponse.response?.urlRsp?.urlResponses?.map(
              (response, index) => ({
                result: response.result ?? -1,
                relativePath:
                  response.relativeFilePath ?? relativePaths[index] ?? '',
                urls:
                  response.downloadUrls?.flatMap(
                    (downloadUrl) => downloadUrl.urls ?? []
                  ) ?? []
              })
            ) ?? []
        };
      }
    );
  }

  public async getManifestAssetUrls(
    session: StoredSession,
    productId: number,
    manifestHash: string
  ): Promise<ManifestAssetUrlResult> {
    const result = await this.getDownloadUrlsForRelativePaths(
      session,
      productId,
      [
        `manifests/${manifestHash}.manifest`,
        `manifests/${manifestHash}.metadata`,
        `manifests/${manifestHash}.licenses`
      ]
    );

    return {
      manifestUrl: findAssetUrl(result.responses, '.manifest'),
      metadataUrl: findAssetUrl(result.responses, '.metadata'),
      licensesUrl: findAssetUrl(result.responses, '.licenses'),
      ownershipTokenExpiresAt: result.ownershipTokenExpiresAt,
      responses: result.responses
    };
  }

  public async destroy(): Promise<void> {
    await this.demux?.destroy();
    this.demux = undefined;
    this.authenticatedTicket = undefined;
    this.ownershipConnection = undefined;
    this.ownershipInitializedSessionId = undefined;
    this.cachedOwnedGames = undefined;
  }

  private async withRetry<T>(
    operationName: string,
    operation: () => Promise<T>
  ): Promise<T> {
    const attempts = Math.max(1, (this.config.httpRetryCount ?? 0) + 1);
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt >= attempts) {
          break;
        }

        this.logger.debug('retrying demux operation', {
          operationName,
          attempt,
          attempts,
          error: error instanceof Error ? error.message : String(error)
        });
        await this.destroy();
      }
    }

    throw lastError;
  }

  private async initializeOwnership(session: StoredSession): Promise<void> {
    if (this.ownershipInitializedSessionId === session.sessionId) {
      return;
    }

    const ownership = await this.getOwnershipConnection(session);
    const response = (await ownership.request({
      request: {
        requestId: 1,
        initializeReq: {
          getAssociations: true,
          protoVersion: 7,
          useStaging: false
        },
        ubiTicket: session.ticket,
        ubiSessionId: session.sessionId
      }
    })) as DemuxOwnershipInitializeResponse;

    if (!response.response?.initializeRsp?.success) {
      throw new Error('Demux ownership initialization failed.');
    }

    this.cachedOwnedGames =
      response.response.initializeRsp.ownedGames?.ownedGames ?? [];
    this.ownershipInitializedSessionId = session.sessionId;
    this.logger.debug('initialized demux ownership service', {
      ownedGames: this.cachedOwnedGames.length
    });
  }

  private async getOwnershipConnection(
    session: StoredSession
  ): Promise<DemuxConnectionLike> {
    if (this.ownershipConnection) {
      await this.getAuthenticatedDemux(session);
      return this.ownershipConnection;
    }

    const demux = await this.getAuthenticatedDemux(session);
    this.ownershipConnection = await demux.openConnection('ownership_service');
    return this.ownershipConnection;
  }

  private async getAuthenticatedDemux(
    session: StoredSession
  ): Promise<UbisoftDemuxLike> {
    const demux = await this.getDemux();
    if (this.authenticatedTicket === session.ticket) {
      return demux;
    }

    const patchInfo = await this.getPatchInfo();
    if (!patchInfo?.latestVersion) {
      throw new Error(
        'Demux patch negotiation did not return a latest version.'
      );
    }

    await demux.socket.push({
      clientVersion: {
        version: patchInfo.latestVersion
      }
    });

    const authResponse = (await demux.basicRequest({
      authenticateReq: {
        clientId: 'uplay_pc',
        sendKeepAlive: false,
        token: {
          ubiTicket: session.ticket
        }
      }
    })) as DemuxAuthenticateResponse;

    if (!authResponse.authenticateRsp?.success) {
      throw new Error('Demux authentication failed.');
    }

    this.authenticatedTicket = session.ticket;
    this.ownershipConnection = undefined;
    this.ownershipInitializedSessionId = undefined;
    this.cachedOwnedGames = undefined;
    this.logger.debug('authenticated demux client', {
      latestVersion: patchInfo.latestVersion
    });

    return demux;
  }

  private async getDemux(): Promise<UbisoftDemuxLike> {
    if (this.demux) {
      return this.demux;
    }

    const demuxModule = await this.moduleLoader();
    this.demux = new demuxModule.UbisoftDemux({
      timeout: this.config.httpTimeoutMs,
      tlsConnectionOptions: {
        minVersion: 'TLSv1.2',
        maxVersion: 'TLSv1.2'
      }
    });
    return this.demux;
  }
}
