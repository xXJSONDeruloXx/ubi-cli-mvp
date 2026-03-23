import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { zstdCompressSync } from 'node:zlib';
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
            responses: relativePaths
              .filter(
                (relativePath) =>
                  relativePath ===
                    'slices_v3/e/8E5F678ECDBBA7EF59483BABB9A6282196C8A90E' ||
                  relativePath ===
                    'slices_v3/a/2A10574931F301B504468475F22D010EE80344D4'
              )
              .map((relativePath) => ({
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

  it('experimentally reconstructs a manifest file by downloading and stitching decompressed slices', async () => {
    const firstSliceCompressed = zstdCompressSync(Buffer.from('Hello '));
    const secondSliceCompressed = zstdCompressSync(Buffer.from('World'));
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
            responses: relativePaths.map((relativePath) => ({
              result: 0,
              relativePath,
              urls: [`https://example.test/${relativePath}`]
            }))
          })
      } as never,
      {
        requestRaw: (url: string) =>
          Promise.resolve({
            status: 200,
            body: url.includes('665A69EDD249A5DE013007219DFAE260C0053112')
              ? firstSliceCompressed
              : secondSliceCompressed
          })
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
                  {
                    name: 'bin/game.txt',
                    size: 11,
                    isDir: false,
                    sliceList: [
                      {
                        downloadSha1: Buffer.from(
                          '665A69EDD249A5DE013007219DFAE260C0053112',
                          'hex'
                        ),
                        fileOffset: 0,
                        size: 6
                      },
                      {
                        downloadSha1: Buffer.from(
                          '2A10574931F301B504468475F22D010EE80344D4',
                          'hex'
                        ),
                        fileOffset: 6,
                        size: 5
                      }
                    ]
                  }
                ]
              }
            ]
          }
        })
    });

    const result = await service.extractFile(
      '46',
      'bin/game.txt',
      '/tmp/ubi-extract-test/game.txt'
    );
    const reconstructed = await readFile(
      '/tmp/ubi-extract-test/game.txt',
      'utf8'
    );

    expect(result).toMatchObject({
      title: 'Far Cry® 3',
      demuxProductId: 46,
      publicProductId: 46,
      manifestHash: 'LIVEHASH',
      manifestPath: 'bin/game.txt',
      outputPath: '/tmp/ubi-extract-test/game.txt',
      sliceCount: 2,
      bytesWritten: 11
    });
    expect(reconstructed).toBe('Hello World');
  });

  it('falls back to sequential slice offsets when manifest slice fileOffset values are all zero defaults', async () => {
    const firstSlice = Buffer.from('MZ-first-half');
    const secondSlice = Buffer.from('second-half');
    const firstSliceCompressed = zstdCompressSync(firstSlice);
    const secondSliceCompressed = zstdCompressSync(secondSlice);
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
            responses: relativePaths.map((relativePath) => ({
              result: 0,
              relativePath,
              urls: [`https://example.test/${relativePath}`]
            }))
          })
      } as never,
      {
        requestRaw: (url: string) =>
          Promise.resolve({
            status: 200,
            body: url.includes('665A69EDD249A5DE013007219DFAE260C0053112')
              ? firstSliceCompressed
              : secondSliceCompressed
          })
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
                  {
                    name: 'bin/game.exe',
                    size: firstSlice.length + secondSlice.length,
                    isDir: false,
                    slices: [
                      createHash('sha1').update(firstSlice).digest('base64'),
                      createHash('sha1').update(secondSlice).digest('base64')
                    ],
                    sliceList: [
                      {
                        downloadSha1: Buffer.from(
                          '665A69EDD249A5DE013007219DFAE260C0053112',
                          'hex'
                        ),
                        fileOffset: 0,
                        size: firstSlice.length
                      },
                      {
                        downloadSha1: Buffer.from(
                          '2A10574931F301B504468475F22D010EE80344D4',
                          'hex'
                        ),
                        fileOffset: 0,
                        size: secondSlice.length
                      }
                    ]
                  }
                ]
              }
            ]
          }
        })
    });

    const result = await service.extractFile(
      '46',
      'bin/game.exe',
      '/tmp/ubi-extract-test/game.exe'
    );
    const reconstructed = await readFile(
      '/tmp/ubi-extract-test/game.exe',
      'utf8'
    );

    expect(reconstructed).toBe('MZ-first-halfsecond-half');
    expect(result.notes[0]).toContain('Validated 2 decompressed slice SHA-1');
  });

  it('extracts multiple matching files while reusing downloaded slice payloads across the batch', async () => {
    const sharedSlice = Buffer.from('Shared-');
    const uniqueSlice = Buffer.from('Unique');
    const sharedSliceCompressed = zstdCompressSync(sharedSlice);
    const uniqueSliceCompressed = zstdCompressSync(uniqueSlice);
    let sharedFetchCount = 0;
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
            responses: relativePaths.map((relativePath) => ({
              result: 0,
              relativePath,
              urls: [`https://example.test/${relativePath}`]
            }))
          })
      } as never,
      {
        requestRaw: (url: string) => {
          if (url.includes('665A69EDD249A5DE013007219DFAE260C0053112')) {
            sharedFetchCount += 1;
            return Promise.resolve({
              status: 200,
              body: sharedSliceCompressed
            });
          }

          return Promise.resolve({
            status: 200,
            body: uniqueSliceCompressed
          });
        }
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
                  {
                    name: 'bin/shared.txt',
                    size: sharedSlice.length,
                    isDir: false,
                    slices: [
                      createHash('sha1').update(sharedSlice).digest('base64')
                    ],
                    sliceList: [
                      {
                        downloadSha1: Buffer.from(
                          '665A69EDD249A5DE013007219DFAE260C0053112',
                          'hex'
                        ),
                        fileOffset: 0,
                        size: sharedSlice.length
                      }
                    ]
                  },
                  {
                    name: 'bin/shared-plus.txt',
                    size: sharedSlice.length + uniqueSlice.length,
                    isDir: false,
                    slices: [
                      createHash('sha1').update(sharedSlice).digest('base64'),
                      createHash('sha1').update(uniqueSlice).digest('base64')
                    ],
                    sliceList: [
                      {
                        downloadSha1: Buffer.from(
                          '665A69EDD249A5DE013007219DFAE260C0053112',
                          'hex'
                        ),
                        fileOffset: 0,
                        size: sharedSlice.length
                      },
                      {
                        downloadSha1: Buffer.from(
                          '2A10574931F301B504468475F22D010EE80344D4',
                          'hex'
                        ),
                        fileOffset: sharedSlice.length,
                        size: uniqueSlice.length
                      }
                    ]
                  }
                ]
              }
            ]
          }
        })
    });

    const result = await service.extractFiles('46', 'bin\\shared', {
      limit: 5,
      outputDir: '/tmp/ubi-extract-batch-test'
    });
    const sharedOutput = await readFile(
      '/tmp/ubi-extract-batch-test/bin/shared.txt',
      'utf8'
    );
    const sharedPlusOutput = await readFile(
      '/tmp/ubi-extract-batch-test/bin/shared-plus.txt',
      'utf8'
    );

    expect(sharedOutput).toBe('Shared-');
    expect(sharedPlusOutput).toBe('Shared-Unique');
    expect(sharedFetchCount).toBe(1);
    expect(result).toMatchObject({
      matchedCount: 2,
      extractedCount: 2,
      sliceReferenceCount: 3,
      uniqueSliceCount: 2,
      outputDir: '/tmp/ubi-extract-batch-test'
    });
    expect(result.files.map((file) => file.manifestPath).sort()).toEqual([
      'bin/shared-plus.txt',
      'bin/shared.txt'
    ]);
    expect(result.notes[1]).toContain('reuses downloaded slices');
  });
});
