import { describe, expect, it } from 'vitest';
import {
  manifestPathMatches,
  normalizeManifestPathForMatch
} from '../src/util/manifest-paths';

describe('manifest path helpers', () => {
  it('normalizes slash styles and casing for manifest path matching', () => {
    expect(
      normalizeManifestPathForMatch('Support\\Readme\\Arabic\\Readme.txt')
    ).toBe('support/readme/arabic/readme.txt');
    expect(
      normalizeManifestPathForMatch('Support//Readme/Arabic/Readme.txt')
    ).toBe('support/readme/arabic/readme.txt');
  });

  it('supports substring and prefix matching across slash styles', () => {
    expect(
      manifestPathMatches(
        'Support\\Readme\\Arabic\\Readme.txt',
        'readme/arabic'
      )
    ).toBe(true);
    expect(
      manifestPathMatches(
        'Support\\Readme\\Arabic\\Readme.txt',
        'Support\\Readme',
        true
      )
    ).toBe(true);
    expect(
      manifestPathMatches(
        'Support\\Readme\\Arabic\\Readme.txt',
        'Arabic\\Readme',
        true
      )
    ).toBe(false);
  });
});
