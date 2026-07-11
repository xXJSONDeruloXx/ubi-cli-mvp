import { describe, expect, it } from 'vitest';
import path from 'node:path';
import {
  manifestPathMatches,
  normalizeManifestPathForMatch,
  resolveManifestOutputPath
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

  it('resolves valid manifest paths below the selected output root', () => {
    expect(
      resolveManifestOutputPath(
        '/tmp/ubi-output',
        'Support\\Readme/English.txt'
      )
    ).toBe(path.join('/tmp/ubi-output', 'Support', 'Readme', 'English.txt'));
  });

  it.each([
    '../escape.txt',
    'nested/../../escape.txt',
    '/etc/passwd',
    '\\\\server\\share\\file.txt',
    'C:\\temp\\file.txt',
    'nested//file.txt',
    'nested/./file.txt',
    'nested/\0file.txt'
  ])('rejects unsafe manifest output path %j', (manifestPath) => {
    expect(() =>
      resolveManifestOutputPath('/tmp/ubi-output', manifestPath)
    ).toThrow(/manifest output path|Manifest path/);
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
