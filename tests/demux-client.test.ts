import { describe, expect, it } from 'vitest';
import { DemuxClient } from '../src/core/demux-client';
import type { StoredSession } from '../src/core/session-store';

function createConfig() {
  return {
    httpTimeoutMs: 15000
  } as never;
}

function createLogger() {
  return {
    child: () => createLogger(),
    debug: () => undefined
  } as never;
}

describe('demux client', () => {
  it('negotiates patch version, pushes clientVersion, authenticates, and initializes ownership', async () => {
    const basicRequests: unknown[] = [];
    const pushes: unknown[] = [];
    const connectionRequests: unknown[] = [];

    const ownershipConnection = {
      connectionId: 1,
      request: (payload: unknown) => {
        connectionRequests.push(payload);
        return Promise.resolve({
          response: {
            initializeRsp: {
              success: true,
              ownedGames: {
                ownedGames: [
                  { productId: 3539, owned: true, state: 3, productType: 0 }
                ]
              }
            }
          }
        });
      }
    };

    const moduleLoader = () =>
      Promise.resolve({
        UbisoftDemux: class {
          public socket = {
            push: (payload: unknown) => {
              pushes.push(payload);
              return Promise.resolve();
            }
          };

          public basicRequest(payload: unknown) {
            basicRequests.push(payload);
            if (
              typeof payload === 'object' &&
              payload !== null &&
              'getPatchInfoReq' in payload
            ) {
              return Promise.resolve({
                getPatchInfoRsp: {
                  success: true,
                  latestVersion: 13099
                }
              });
            }

            return Promise.resolve({
              authenticateRsp: {
                success: true
              }
            });
          }

          public openConnection() {
            return Promise.resolve(ownershipConnection);
          }

          public destroy() {
            return Promise.resolve();
          }
        }
      });

    const client = new DemuxClient(createConfig(), createLogger(), {
      moduleLoader
    });
    const session: StoredSession = {
      ticket: 'ticket',
      sessionId: 'session',
      userId: 'user'
    };

    const games = await client.listOwnedGames(session);

    expect(games).toHaveLength(1);
    expect(basicRequests).toEqual([
      {
        getPatchInfoReq: {
          patchTrackId: 'DEFAULT',
          testConfig: false,
          trackType: 0
        }
      },
      {
        authenticateReq: {
          clientId: 'uplay_pc',
          sendKeepAlive: false,
          token: {
            ubiTicket: 'ticket'
          }
        }
      }
    ]);
    expect(pushes).toEqual([
      {
        clientVersion: {
          version: 13099
        }
      }
    ]);
    expect(connectionRequests).toEqual([
      {
        request: {
          requestId: 1,
          initializeReq: {
            getAssociations: true,
            protoVersion: 7,
            useStaging: false
          },
          ubiTicket: 'ticket',
          ubiSessionId: 'session'
        }
      }
    ]);

    await client.destroy();
  });

  it('requests ownership-token and live manifest asset URLs through download_service', async () => {
    const connectionRequests: Array<{ service: string; payload: unknown }> = [];
    const moduleLoader = () =>
      Promise.resolve({
        UbisoftDemux: class {
          public socket = {
            push: () => Promise.resolve()
          };

          public basicRequest(payload: unknown) {
            if (
              typeof payload === 'object' &&
              payload !== null &&
              'getPatchInfoReq' in payload
            ) {
              return Promise.resolve({
                getPatchInfoRsp: {
                  success: true,
                  latestVersion: 13099
                }
              });
            }

            return Promise.resolve({
              authenticateRsp: {
                success: true
              }
            });
          }

          public openConnection(
            serviceName: 'ownership_service' | 'download_service'
          ) {
            if (serviceName === 'ownership_service') {
              return Promise.resolve({
                connectionId: 1,
                request: (payload: unknown) => {
                  connectionRequests.push({ service: serviceName, payload });
                  if (
                    typeof payload === 'object' &&
                    payload !== null &&
                    'request' in payload &&
                    typeof payload.request === 'object' &&
                    payload.request !== null &&
                    'initializeReq' in payload.request
                  ) {
                    return Promise.resolve({
                      response: {
                        initializeRsp: {
                          success: true,
                          ownedGames: { ownedGames: [] }
                        }
                      }
                    });
                  }

                  return Promise.resolve({
                    response: {
                      ownershipTokenRsp: {
                        token: 'ownership-token',
                        expiration: 1774299000
                      }
                    }
                  });
                }
              });
            }

            return Promise.resolve({
              connectionId: 2,
              request: (payload: unknown) => {
                connectionRequests.push({ service: serviceName, payload });
                if (
                  typeof payload === 'object' &&
                  payload !== null &&
                  'request' in payload &&
                  typeof payload.request === 'object' &&
                  payload.request !== null &&
                  'initializeReq' in payload.request
                ) {
                  return Promise.resolve({
                    response: {
                      initializeRsp: {
                        ok: true
                      }
                    }
                  });
                }

                return Promise.resolve({
                  response: {
                    urlRsp: {
                      urlResponses: [
                        {
                          result: 0,
                          relativeFilePath: 'manifests/hash.manifest',
                          downloadUrls: [
                            { urls: ['https://example.test/hash.manifest'] }
                          ]
                        },
                        {
                          result: 0,
                          relativeFilePath: 'manifests/hash.metadata',
                          downloadUrls: [
                            { urls: ['https://example.test/hash.metadata'] }
                          ]
                        },
                        {
                          result: 0,
                          relativeFilePath: 'manifests/hash.licenses',
                          downloadUrls: [
                            { urls: ['https://example.test/hash.licenses'] }
                          ]
                        }
                      ]
                    }
                  }
                });
              }
            });
          }

          public destroy() {
            return Promise.resolve();
          }
        }
      });

    const client = new DemuxClient(createConfig(), createLogger(), {
      moduleLoader
    });
    const session: StoredSession = {
      ticket: 'ticket',
      sessionId: 'session',
      userId: 'user'
    };

    const result = await client.getManifestAssetUrls(session, 3539, 'hash');

    expect(result).toMatchObject({
      manifestUrl: 'https://example.test/hash.manifest',
      metadataUrl: 'https://example.test/hash.metadata',
      licensesUrl: 'https://example.test/hash.licenses',
      ownershipTokenExpiresAt: '1774299000'
    });
    expect(connectionRequests.map((entry) => entry.service)).toEqual([
      'ownership_service',
      'ownership_service',
      'download_service',
      'download_service'
    ]);

    await client.destroy();
  });
});
