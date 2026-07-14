import {
  chmod,
  lstat,
  mkdtemp,
  mkdir,
  readFile,
  writeFile
} from 'node:fs/promises';
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

  it('requires an explicit prefix before starting Connect', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    await writeFile(path.join(root, 'game.exe'), 'test');
    const program = new Command();
    registerRunCommand(program);

    await expect(
      program.parseAsync([
        'node',
        'ubi',
        'run',
        root,
        '--runner',
        'wine',
        '--connect',
        '--dry-run'
      ])
    ).rejects.toThrow(/explicit --wine-prefix/);
  });

  it('starts Connect in the explicit prefix before launching the game', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    const systemDir = path.join(root, 'system');
    const prefix = path.join(root, 'prefix');
    const connectDir = path.join(
      prefix,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher'
    );
    const game = path.join(systemDir, 'game.exe');
    const connect = path.join(connectDir, 'UbisoftConnect.exe');
    const runner = path.join(root, 'runner');
    const observed = path.join(root, 'launches.txt');
    await mkdir(systemDir);
    await mkdir(connectDir, { recursive: true });
    await writeFile(game, 'test');
    await writeFile(connect, 'test');
    await writeFile(
      runner,
      `#!/bin/sh\nprintf '%s|%s|%s\\n' "$PWD" "$WINEPREFIX" "$*" >> ${JSON.stringify(observed)}\n`
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
      runner,
      '--runner-arg',
      'run',
      '--wine-prefix',
      prefix,
      '--connect',
      '--connect-ready'
    ]);

    await expect(readFile(observed, 'utf8')).resolves.toBe(
      `${connectDir}|${prefix}|run ${connect}\n${systemDir}|${prefix}|run ${game}\n`
    );
  });

  it('launches a registered product through the official Connect URI', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    const prefix = path.join(root, 'prefix');
    const connectDir = path.join(
      prefix,
      'drive_c',
      'Program Files (x86)',
      'Ubisoft',
      'Ubisoft Game Launcher'
    );
    const connect = path.join(connectDir, 'UbisoftConnect.exe');
    const runner = path.join(root, 'runner');
    const observed = path.join(root, 'launches.txt');
    await mkdir(connectDir, { recursive: true });
    await writeFile(path.join(root, 'game.exe'), 'test');
    await writeFile(connect, 'test');
    await writeFile(
      runner,
      `#!/bin/sh\nprintf '%s|%s|%s\\n' "$PWD" "$WINEPREFIX" "$*" >> ${JSON.stringify(observed)}\n`
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
      'game.exe',
      '--runner',
      runner,
      '--runner-arg',
      'run',
      '--wine-prefix',
      prefix,
      '--connect',
      '--connect-ready',
      '--connect-product-id',
      '109'
    ]);

    await expect(readFile(observed, 'utf8')).resolves.toBe(
      `${connectDir}|${prefix}|run ${connect} uplay://launch/109/0\n`
    );
  });

  it('refuses an unattended client install without explicit consent', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-run-'));
    const prefix = path.join(root, 'prefix');
    await writeFile(path.join(root, 'game.exe'), 'test');
    const program = new Command();
    registerRunCommand(program);

    await expect(
      program.parseAsync([
        'node',
        'ubi',
        'run',
        root,
        '--runner',
        'wine',
        '--wine-prefix',
        prefix,
        '--ensure-connect'
      ])
    ).rejects.toThrow(/explicit --ensure-connect --yes/);
    await expect(lstat(prefix)).rejects.toMatchObject({ code: 'ENOENT' });
  });
});
