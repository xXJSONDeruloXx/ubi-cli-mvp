import { describe, expect, it } from 'vitest';
import { DemuxService } from '../src/services/demux-service';

describe('demux service', () => {
  it('normalizes owned games and maps public product ids by app id', async () => {
    const service = new DemuxService(
      {
        debugDir: '/tmp',
        sessionFile: '/tmp/session.json'
      } as never,
      {} as never,
      {
        child: () => ({ child: () => undefined, debug: () => undefined }),
        debug: () => undefined
      } as never,
      {
        findCatalogProductBySpaceId: () => Promise.resolve(undefined),
        findUniqueCatalogProductByAppId: () =>
          Promise.resolve({ productId: 569, appId: 'app-1' }),
        findUniqueCatalogProductByTitle: () => Promise.resolve(undefined)
      } as never,
      undefined,
      {
        ensureValidSession: () =>
          Promise.resolve({
            ticket: 'ticket',
            sessionId: 'session',
            userId: 'user'
          })
      } as never,
      {
        listOwnedGames: () =>
          Promise.resolve([
            {
              productId: 2916,
              owned: true,
              state: 3,
              productType: 0,
              productAssociations: [1018],
              configuration: `version: 2\nroot:\n  name: For Honor\n  installer:\n    publisher: Ubisoft\n  uplay:\n    game_code: FORHONOR\n`,
              ubiservicesAppId: 'app-1',
              latestManifest: ' HASH ',
              activeBranchId: 2,
              availableBranches: [
                { branchId: 1, branchName: 'default' },
                { branchId: 2, branchName: 'live' }
              ]
            }
          ])
      } as never,
      {
        requestRaw: () =>
          Promise.resolve({ status: 200, body: Buffer.from('') })
      } as never
    );

    const items = await service.listOwnedGames();

    expect(items[0]).toMatchObject({
      title: 'For Honor',
      demuxProductId: 2916,
      publicProductId: 569,
      latestManifest: 'HASH',
      hasDownloadManifest: true,
      gameCode: 'FORHONOR'
    });
    expect(items[0]?.branches).toEqual([
      { branchId: 1, branchName: 'default', active: false },
      { branchId: 2, branchName: 'live', active: true }
    ]);
  });

  it('resolves a game by public product id after normalization', async () => {
    const service = new DemuxService(
      {
        debugDir: '/tmp',
        sessionFile: '/tmp/session.json'
      } as never,
      {} as never,
      {
        child: () => ({ child: () => undefined, debug: () => undefined }),
        debug: () => undefined
      } as never,
      {
        findCatalogProductBySpaceId: () => Promise.resolve(undefined),
        findUniqueCatalogProductByAppId: () =>
          Promise.resolve({ productId: 569, appId: 'app-1' }),
        findUniqueCatalogProductByTitle: () => Promise.resolve(undefined)
      } as never,
      undefined,
      {
        ensureValidSession: () =>
          Promise.resolve({
            ticket: 'ticket',
            sessionId: 'session',
            userId: 'user'
          })
      } as never,
      {
        listOwnedGames: () =>
          Promise.resolve([
            {
              productId: 2916,
              owned: true,
              state: 3,
              productType: 0,
              configuration: 'root:\n  name: For Honor\n',
              ubiservicesAppId: 'app-1'
            }
          ])
      } as never,
      {
        requestRaw: () =>
          Promise.resolve({ status: 200, body: Buffer.from('') })
      } as never
    );

    const item = await service.resolveOwnedGame('569');
    expect(item.demuxProductId).toBe(2916);
  });
});
