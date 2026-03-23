import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadUbisoftDemuxModule } from '../src/core/ubisoft-demux-loader';
import {
  filterManifestFiles,
  summarizeManifestFileSubset,
  summarizeParsedLicenses,
  summarizeParsedManifest,
  summarizeParsedMetadata,
  toManifestFiles
} from '../src/services/manifest-service';

describe('manifest summary helpers', () => {
  it('summarizes install/download sizes and largest files from the public fixture', async () => {
    const fixture = await readFile(
      path.join(
        process.cwd(),
        'tests/fixtures/manifests/46_0C3D19B8681787293905C848F20553A0D21133C6.manifest'
      )
    );
    const { UbisoftFileParser } = await loadUbisoftDemuxModule();
    const parser = new UbisoftFileParser();
    const parsed = parser.parseDownloadManifest(fixture);

    const summary = summarizeParsedManifest(
      parsed,
      '0C3D19B8681787293905C848F20553A0D21133C6'
    );
    const files = toManifestFiles(parsed);

    expect(summary.installBytes).toBe('11628461616');
    expect(summary.downloadBytes).toBe('10084216628');
    expect(files[0]).toMatchObject({
      path: 'data_win32/worlds/fc3_main/fc3_main.dat',
      installBytes: '3496061837',
      downloadBytes: '3149129292',
      sliceCount: 3335,
      isDirectory: false
    });
  });

  it('summarizes parsed metadata and licenses', () => {
    const metadata = summarizeParsedMetadata({
      bytesOnDisk: '42',
      bytesToDownload: 24,
      licenses: [{}, {}],
      chunks: [{}, {}, {}],
      languages: [{ code: 'en-US' }, { code: 'fr-FR' }],
      uplayIds: [200, 100, 200]
    });
    const licenses = summarizeParsedLicenses({
      licenses: [
        {
          identifier: 'eula',
          locales: [{ language: 'en-US' }, { language: 'fr-FR' }]
        },
        {
          identifier: 'privacy',
          locales: [{ language: 'en-US' }]
        }
      ]
    });

    expect(metadata).toEqual({
      bytesOnDisk: '42',
      bytesToDownload: '24',
      chunkCount: 3,
      licenseCount: 2,
      languageCodes: ['en-US', 'fr-FR'],
      uplayIds: [100, 200]
    });
    expect(licenses).toEqual({
      licenseCount: 2,
      localeCount: 3,
      identifiers: ['eula', 'privacy'],
      languageCodes: ['en-US', 'fr-FR']
    });
  });

  it('filters manifest files by normalized path and summarizes the subset', () => {
    const files = filterManifestFiles(
      [
        {
          path: 'Support\\Readme\\English\\Readme.txt',
          installBytes: '10',
          downloadBytes: '4',
          sliceCount: 1,
          isDirectory: false
        },
        {
          path: 'Support\\Readme\\French\\Readme.txt',
          installBytes: '20',
          downloadBytes: '6',
          sliceCount: 1,
          isDirectory: false
        },
        {
          path: 'bin\\game.exe',
          installBytes: '100',
          downloadBytes: '70',
          sliceCount: 3,
          isDirectory: false
        }
      ],
      'support/readme',
      true
    );

    expect(files.map((file) => file.path)).toEqual([
      'Support\\Readme\\English\\Readme.txt',
      'Support\\Readme\\French\\Readme.txt'
    ]);
    expect(summarizeManifestFileSubset(files)).toEqual({
      installBytes: '30',
      downloadBytes: '10',
      fileCount: 2
    });
  });
});
