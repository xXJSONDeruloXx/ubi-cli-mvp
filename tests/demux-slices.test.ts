import { describe, expect, it } from 'vitest';
import {
  collectUniqueSliceHexHashes,
  collectUniqueSlicePaths,
  sliceHexToCandidateRelativePaths,
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
    const parsed = {
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
    };
    const paths = collectUniqueSlicePaths(parsed, 10);

    expect(paths).toEqual([
      'slices_v3/6/665A69EDD249A5DE013007219DFAE260C0053112',
      'slices_v3/a/2A10574931F301B504468475F22D010EE80344D4'
    ]);
    expect(collectUniqueSliceHexHashes(parsed, 10)).toEqual([
      '665A69EDD249A5DE013007219DFAE260C0053112',
      '2A10574931F301B504468475F22D010EE80344D4'
    ]);
  });

  it('enumerates all candidate relative paths for a slice hash', () => {
    const candidates = sliceHexToCandidateRelativePaths(
      'AB7AEC6502718500BDB8EAA455FCF09D5E81EFE3'
    );

    expect(candidates).toHaveLength(32);
    expect(candidates[0]).toBe(
      'slices_v3/0/AB7AEC6502718500BDB8EAA455FCF09D5E81EFE3'
    );
    expect(candidates.at(-1)).toBe(
      'slices_v3/v/AB7AEC6502718500BDB8EAA455FCF09D5E81EFE3'
    );
  });
});
