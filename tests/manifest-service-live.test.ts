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
              licensesUrl: 'https://example.test/live.licenses'
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
});
