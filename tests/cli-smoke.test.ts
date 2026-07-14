import { execa } from 'execa';
import { beforeAll, describe, expect, it } from 'vitest';

async function run(command: string, args: string[]): Promise<string> {
  const result = await execa(command, args, {
    env: {
      ...process.env
    }
  });

  return result.stdout;
}

describe('cli smoke test', () => {
  beforeAll(async () => {
    await execa('npm', ['run', 'build']);
  }, 120_000);

  it('runs doctor in json mode', async () => {
    const stdout = await run('node', ['dist/index.js', 'doctor', '--json']);
    const parsed = JSON.parse(stdout) as {
      appName: string;
      nodeVersion: string;
    };

    expect(parsed.appName).toBe('ubi-cli-mvp');
    expect(parsed.nodeVersion.startsWith('v')).toBe(true);
  }, 120_000);

  it('shows newly registered exploratory commands in help output', async () => {
    const stdout = await run('node', ['dist/index.js', '--help']);

    expect(stdout).toContain('addons');
    expect(stdout).toContain('files');
    expect(stdout).toContain('download-plan');
    expect(stdout).toContain('search');
    expect(stdout).toContain('demux-list');
    expect(stdout).toContain('demux-info');
    expect(stdout).toContain('download-urls');
    expect(stdout).toContain('slice-urls');
    expect(stdout).toContain('download-slices');
    expect(stdout).toContain('extract-file');
    expect(stdout).toContain('extract-files');
    expect(stdout).toContain('download-game');
    expect(stdout).toContain('run');
    expect(stdout).toContain('connect-seed');
  }, 120_000);

  it('advertises bounded full-game download safeguards', async () => {
    const stdout = await run('node', [
      'dist/index.js',
      'download-game',
      '--help'
    ]);

    expect(stdout).toContain('--limit');
    expect(stdout).toContain('--max-install-bytes');
    expect(stdout).toContain('--all');
    expect(stdout).toContain('--yes');
    expect(stdout).toContain('--dry-run');
    expect(stdout).toContain('--restart');
  }, 120_000);

  it('advertises the explicit guided Connect safeguards', async () => {
    const stdout = await run('node', ['dist/index.js', 'run', '--help']);

    expect(stdout).toContain('--wine-prefix');
    expect(stdout).toContain('--connect');
    expect(stdout).toContain('--ensure-connect');
    expect(stdout).toContain('--connect-installer');
    expect(stdout).toContain('--connect-ready');
    expect(stdout).toContain('--connect-product-id');
    expect(stdout).toContain('--yes');

    const seedHelp = await run('node', [
      'dist/index.js',
      'connect-seed',
      '--help'
    ]);
    expect(seedHelp).toContain('--product-id');
    expect(seedHelp).toContain('--dry-run');
    expect(seedHelp).toContain('--yes');
    expect(seedHelp).toContain('--finalize');
    expect(seedHelp).toContain('--launch');
  }, 120_000);
});
