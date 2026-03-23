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

  it('derives slice URLs from a parsed live manifest', async () => {
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
        findUniqueCatalogProductByAppId: () => Promise.resolve(undefined),
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
        getDownloadUrlsForRelativePaths: (
          _session: unknown,
          _productId: number,
          relativePaths: string[]
        ) =>
          Promise.resolve({
            ownershipTokenExpiresAt: '1774300461',
            responses: relativePaths.map((relativePath) => ({
              result: 0,
              relativePath,
              urls: [`https://example.test/${relativePath}`]
            }))
          })
      } as never,
      {
        requestRaw: () =>
          Promise.resolve({ status: 200, body: Buffer.from('') })
      } as never
    );

    Object.assign(service as object, {
      parseLiveManifest: () =>
        Promise.resolve({
          download: {
            game: {
              title: 'Far Cry® 3',
              demuxProductId: 46,
              publicProductId: 46
            },
            manifestHash: 'LIVEHASH'
          },
          parsed: {
            chunks: [
              {
                files: [
                  { slices: ['jl9njs27p+9ZSDuruaYoIZbIqQ4='] },
                  { slices: ['KhBXSTHzAbUERoR18i0BDugDRNQ='] }
                ]
              }
            ]
          }
        })
    });

    const info = await service.getSliceUrls('46', 2);

    expect(info).toMatchObject({
      title: 'Far Cry® 3',
      demuxProductId: 46,
      publicProductId: 46,
      manifestHash: 'LIVEHASH',
      totalUniqueSliceCount: 2,
      requestedSliceCount: 2,
      ownershipTokenExpiresAt: '1774300461'
    });
    expect(info.urls[0]?.relativePath).toBe(
      'slices_v3/e/8E5F678ECDBBA7EF59483BABB9A6282196C8A90E'
    );
  });

  it('downloads raw slice payloads to disk without reconstructing game files', async () => {
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
        findUniqueCatalogProductByAppId: () => Promise.resolve(undefined),
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
      {} as never,
      {
        requestRaw: (url: string) =>
          Promise.resolve(
            url.endsWith('/primary')
              ? { status: 404, body: Buffer.from('') }
              : { status: 200, body: Buffer.from('slice-bytes') }
          )
      } as never
    );

    Object.assign(service as object, {
      getSliceUrls: () =>
        Promise.resolve({
          title: 'Far Cry® 3',
          demuxProductId: 46,
          publicProductId: 46,
          manifestHash: 'LIVEHASH',
          totalUniqueSliceCount: 1,
          requestedSliceCount: 1,
          urls: [
            {
              relativePath:
                'slices_v3/e/8E5F678ECDBBA7EF59483BABB9A6282196C8A90E',
              result: 0,
              urls: [
                'https://example.test/primary',
                'https://example.test/fallback'
              ]
            }
          ],
          notes: []
        })
    });

    const result = await service.downloadSlices('46', 1, '/tmp/ubi-slice-test');

    expect(result).toMatchObject({
      title: 'Far Cry® 3',
      demuxProductId: 46,
      publicProductId: 46,
      manifestHash: 'LIVEHASH',
      outputDir: '/tmp/ubi-slice-test',
      downloadedCount: 1
    });
    expect(result.files[0]?.bytes).toBe(11);
  });
});
