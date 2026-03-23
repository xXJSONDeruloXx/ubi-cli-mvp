import { describe, expect, it } from 'vitest';
import {
  collectUniqueSlicePaths,
  sliceTokenToHex,
  sliceTokenToRelativePath
} from '../src/util/demux-slices';

describe('demux slice helpers', () => {
  it('converts a manifest slice token to the expected CDN relative path', () => {
    const sliceToken = 'jl9njs27p+9ZSDuruaYoIZbIqQ4=';
    expect(sliceTokenToHex(sliceToken)).toBe(
      '8E5F678ECDBBA7EF59483BABB9A6282196C8A90E'
    );
    expect(sliceTokenToRelativePath(sliceToken)).toBe(
      'slices_v3/e/8E5F678ECDBBA7EF59483BABB9A6282196C8A90E'
    );
  });

  it('collects unique slice paths from a parsed manifest shape', () => {
    const paths = collectUniqueSlicePaths(
      {
        chunks: [
          {
            files: [
              {
                sliceList: [{ downloadSha1: 'Zlpp7dJJpd4BMAchnfriYMAFMRI=' }]
              },
              {
                sliceList: [
                  { downloadSha1: 'Zlpp7dJJpd4BMAchnfriYMAFMRI=' },
                  { downloadSha1: 'KhBXSTHzAbUERoR18i0BDugDRNQ=' }
                ]
              }
            ]
          }
        ]
      },
      10
    );

    expect(paths).toEqual([
      'slices_v3/6/665A69EDD249A5DE013007219DFAE260C0053112',
      'slices_v3/a/2A10574931F301B504468475F22D010EE80344D4'
    ]);
  });
});
