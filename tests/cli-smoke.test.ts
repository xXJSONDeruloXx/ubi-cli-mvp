import { mkdtemp, mkdir, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
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

    expect(stdout).toContain('setup');
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
    expect(stdout).toContain('play');
    expect(stdout).toContain('connect-prefix');
    expect(stdout).toContain('connect-profile');
    expect(stdout).toContain('connect-install');
    expect(stdout).toContain('connect-seed');
  }, 120_000);

  it('emits parseable offline setup JSON and a strict incomplete exit', async () => {
    const root = await mkdtemp(path.join(tmpdir(), 'ubi-setup-check-'));
    const result = await execa(
      'node',
      ['dist/index.js', 'setup', '--check', '--strict', '--json'],
      {
        reject: false,
        env: {
          ...process.env,
          XDG_DATA_HOME: path.join(root, 'data'),
          XDG_CONFIG_HOME: path.join(root, 'config'),
          XDG_CACHE_HOME: path.join(root, 'cache'),
          XDG_STATE_HOME: path.join(root, 'state')
        }
      }
    );
    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.stdout)).toMatchObject({
      setupStatus: 'needs-cli-login',
      cliSession: 'missing',
      clientInstalled: false,
      connectStarted: false
    });

    const login = await execa('node', ['dist/index.js', 'login', '--json'], {
      reject: false,
      env: {
        ...process.env,
        XDG_DATA_HOME: path.join(root, 'login-data'),
        XDG_CONFIG_HOME: path.join(root, 'login-config'),
        XDG_CACHE_HOME: path.join(root, 'login-cache'),
        XDG_STATE_HOME: path.join(root, 'login-state'),
        UBI_EMAIL: '',
        UBI_PASSWORD: '',
        UBI_2FA_CODE: ''
      }
    });
    expect(login.exitCode).toBe(1);
    expect(login.stdout).toBe('');
    expect(login.stderr).toContain('Noninteractive login requires');

    const realPrefixParent = path.join(root, 'real-prefix-parent');
    const linkedPrefixParent = path.join(root, 'linked-prefix-parent');
    await mkdir(realPrefixParent);
    await symlink(realPrefixParent, linkedPrefixParent);
    const unsafeSetup = await execa(
      'node',
      [
        'dist/index.js',
        'setup',
        '--wine-prefix',
        path.join(linkedPrefixParent, 'prefix'),
        '--json'
      ],
      {
        reject: false,
        env: {
          ...process.env,
          XDG_DATA_HOME: path.join(root, 'unsafe-data'),
          XDG_CONFIG_HOME: path.join(root, 'unsafe-config'),
          XDG_CACHE_HOME: path.join(root, 'unsafe-cache'),
          XDG_STATE_HOME: path.join(root, 'unsafe-state'),
          UBI_EMAIL: '',
          UBI_PASSWORD: '',
          UBI_2FA_CODE: ''
        }
      }
    );
    expect(unsafeSetup.exitCode).toBe(1);
    expect(unsafeSetup.stderr).toContain(
      'Refusing unsafe, non-owner-only, or unrecognized Wine prefix before authentication'
    );
    expect(unsafeSetup.stderr).not.toContain('Noninteractive login requires');
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
    const setupHelp = await run('node', ['dist/index.js', 'setup', '--help']);
    expect(setupHelp).toContain('--check');
    expect(setupHelp).toContain('--strict');
    expect(setupHelp).toContain('--no-launch-connect');
    expect(setupHelp).toContain('--allow-connect-launch');
    expect(setupHelp).toContain('--trust-existing-connect');
    expect(setupHelp).toContain('--yes');

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

    const cloneHelp = await run('node', [
      'dist/index.js',
      'connect-prefix',
      'clone',
      '--help'
    ]);
    expect(cloneHelp).toContain('--include-auth');
    expect(cloneHelp).toContain('--yes');
    expect(cloneHelp).toContain('--allow-full-copy');

    const migrateAuthHelp = await run('node', [
      'dist/index.js',
      'connect-prefix',
      'migrate-auth',
      '--help'
    ]);
    expect(migrateAuthHelp).toContain('--include-auth');
    expect(migrateAuthHelp).toContain('--runner-arg');

    const installHelp = await run('node', [
      'dist/index.js',
      'connect-install',
      '--help'
    ]);
    expect(installHelp).toContain('--dry-run');

    const playHelp = await run('node', ['dist/index.js', 'play', '--help']);
    expect(playHelp).toContain('--dry-run');
    expect(playHelp).toContain('--leave-connect-open');
  }, 120_000);
});
