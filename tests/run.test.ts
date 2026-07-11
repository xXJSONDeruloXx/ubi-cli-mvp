import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveGameExecutable } from '../src/cli/run';

describe('run command executable resolution', () => {
  it('auto-selects a single executable and contains explicit relative paths', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    await mkdir(path.join(root, 'bin'), { recursive: true });
    await writeFile(path.join(root, 'bin', 'game.exe'), 'test');

    await expect(resolveGameExecutable(root)).resolves.toBe(
      path.join(root, 'bin', 'game.exe')
    );
    await expect(resolveGameExecutable(root, 'bin\\game.exe')).resolves.toBe(
      path.join(root, 'bin', 'game.exe')
    );
    await expect(resolveGameExecutable(root, '../escape.exe')).rejects.toThrow(
      /unsafe manifest output path/
    );
  });

  it('requires an explicit executable when an install has multiple candidates', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    await writeFile(path.join(root, 'first.exe'), 'test');
    await writeFile(path.join(root, 'second.exe'), 'test');

    await expect(resolveGameExecutable(root)).rejects.toThrow(
      /Found 2 executable candidates/
    );
  });
});
