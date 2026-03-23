import { describe, expect, it } from 'vitest';
import { ManifestService } from '../src/services/manifest-service';

describe('manifest service live demux path', () => {
  it('returns parsed-live-demux manifest info from a parsed live manifest payload', async () => {
    const service = new ManifestService(
      {
        debugDir: '/tmp'
      } as never,
      {} as never,
      {
        child: () => ({ child: () => undefined })
      } as never,
      {} as never,
      {} as never,
      {
        parseLiveManifest: () =>
          Promise.resolve({
            download: {
              game: {
                title: 'Far Cry® 3',
                publicProductId: 46,
                demuxProductId: 46
              },
              manifestHash: 'LIVEHASH',
              manifestUrl: 'https://example.test/live.manifest',
              metadataUrl: 'https://example.test/live.metadata',
              licensesUrl: 'https://example.test/live.licenses',
              notes: []
            },
            parsed: {
              version: 3,
              compressionMethod: 1,
              isCompressed: true,
              patchRequired: false,
              languages: [{ code: 'en-US' }],
              chunks: []
            }
          }),
        destroy: () => Promise.resolve()
      } as never
    );

    const info = await service.getLiveManifestInfo('46');

    expect(info).toMatchObject({
      title: 'Far Cry® 3',
      productId: 46,
      selectedManifestHash: 'LIVEHASH',
      rawSourceUrl: 'https://example.test/live.manifest',
      metadataUrl: 'https://example.test/live.metadata',
      licensesUrl: 'https://example.test/live.licenses',
      status: 'parsed-live-demux'
    });
  });

  it('includes parsed metadata and licenses summaries when asset details are requested', async () => {
    const service = new ManifestService(
      {
        debugDir: '/tmp'
      } as never,
      {} as never,
      {
        child: () => ({ child: () => undefined })
      } as never,
      {} as never,
      {} as never,
      {
        parseLiveManifest: (
          _query: string,
          options?: { includeAssetDetails?: boolean }
        ) =>
          Promise.resolve({
            download: {
              game: {
                title: "Assassin's Creed® Origins",
                publicProductId: 3539,
                demuxProductId: 3539
              },
              manifestHash: 'LIVEHASH',
              manifestUrl: 'https://example.test/live.manifest',
              metadataUrl: 'https://example.test/live.metadata',
              licensesUrl: 'https://example.test/live.licenses',
              notes: options?.includeAssetDetails
                ? ['Fetched live metadata and licenses assets.']
                : []
            },
            parsed: {
              version: 3,
              compressionMethod: 1,
              isCompressed: true,
              patchRequired: false,
              languages: [{ code: 'en-US' }],
              chunks: []
            },
            parsedMetadata: options?.includeAssetDetails
              ? {
                  bytesOnDisk: '100',
                  bytesToDownload: '90',
                  licenses: [{}, {}],
                  chunks: [{}, {}],
                  languages: [{ code: 'en-US' }],
                  uplayIds: [10, 20]
                }
              : undefined,
            parsedLicenses: options?.includeAssetDetails
              ? {
                  licenses: [
                    {
                      identifier: 'eula',
                      locales: [{ language: 'en-US' }]
                    }
                  ]
                }
              : undefined
          }),
        destroy: () => Promise.resolve()
      } as never
    );

    const info = await service.getLiveManifestInfo('3539', {
      includeAssetDetails: true
    });

    expect(info.parsedMetadata).toEqual({
      bytesOnDisk: '100',
      bytesToDownload: '90',
      chunkCount: 2,
      licenseCount: 2,
      languageCodes: ['en-US'],
      uplayIds: [10, 20]
    });
    expect(info.parsedLicenses).toEqual({
      licenseCount: 1,
      localeCount: 1,
      identifiers: ['eula'],
      languageCodes: ['en-US']
    });
    expect(info.notes).toContain('Fetched live metadata and licenses assets.');
  });
});
