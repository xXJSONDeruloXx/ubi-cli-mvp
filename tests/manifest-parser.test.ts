import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadUbisoftDemuxModule } from '../src/core/ubisoft-demux-loader';

describe('manifest parser fixture', () => {
  it('parses the public UplayManifests raw fixture', async () => {
    const fixture = await readFile(
      path.join(
        process.cwd(),
        'tests/fixtures/manifests/46_0C3D19B8681787293905C848F20553A0D21133C6.manifest'
      )
    );
    const { UbisoftFileParser } = await loadUbisoftDemuxModule();
    const parser = new UbisoftFileParser();
    const manifest = parser.parseDownloadManifest(fixture);
    const fileCount = (manifest.chunks ?? []).reduce(
      (sum, chunk) => sum + (chunk.files?.length ?? 0),
      0
    );

    expect(manifest.version).toBe(3);
    expect(manifest.compressionMethod).toBe(1);
    expect(manifest.isCompressed).toBe(true);
    expect(manifest.patchRequired).toBe(false);
    expect(manifest.chunks?.length).toBe(1);
    expect(fileCount).toBe(288);
    expect(manifest.languages?.[0]?.code).toBe('en-US');
  });
});
