import { chmod, mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Command } from 'commander';
import { describe, expect, it } from 'vitest';
import { registerRunCommand, resolveGameExecutable } from '../src/cli/run';

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

  it('launches with the executable directory as the working directory', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    const systemDir = path.join(root, 'system');
    const runner = path.join(root, 'runner');
    const observedCwd = path.join(root, 'cwd.txt');
    await mkdir(systemDir);
    await writeFile(path.join(systemDir, 'game.exe'), 'test');
    await writeFile(
      runner,
      `#!/bin/sh\npwd > ${JSON.stringify(observedCwd)}\n`
    );
    await chmod(runner, 0o700);

    const program = new Command();
    registerRunCommand(program);
    await program.parseAsync([
      'node',
      'ubi',
      'run',
      root,
      '--executable',
      'system/game.exe',
      '--runner',
      runner
    ]);

    await expect(readFile(observedCwd, 'utf8')).resolves.toBe(`${systemDir}\n`);
  });
});
