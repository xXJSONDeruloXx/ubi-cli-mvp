import {
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { launcherlessRegistryCommands } from '../src/cli/launcherless';
import {
  cleanupLauncherlessProfiles,
  deployLauncherlessShims,
  inspectLauncherlessPlan,
  restoreLauncherlessInstall,
  writeLauncherlessProfiles
} from '../src/services/launcherless';

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), 'ubi-launcherless-'));
  const installDir = path.join(root, 'game');
  const systemDir = path.join(installDir, 'system');
  const shimDir = path.join(root, 'shims');
  await mkdir(systemDir, { recursive: true });
  await mkdir(path.join(shimDir, 'uplay_r1'), { recursive: true });
  await mkdir(path.join(shimDir, 'orbit_r2'), { recursive: true });
  await mkdir(path.join(shimDir, 'eax'), { recursive: true });
  await writeFile(
    path.join(systemDir, 'game.exe'),
    Buffer.from('MZ...uplay_r1_loader.dll...')
  );
  await writeFile(path.join(systemDir, 'uplay_r1_loader.dll'), 'original-r1');
  await writeFile(path.join(systemDir, 'eax.dll'), 'original-eax');
  await writeFile(
    path.join(shimDir, 'uplay_r1', 'uplay_r1_loader.dll'),
    'shim-r1-32'
  );
  await writeFile(
    path.join(shimDir, 'uplay_r1', 'uplay_r1_loader64.dll'),
    'shim-r1-64'
  );
  await writeFile(
    path.join(shimDir, 'orbit_r2', 'ubiorbitapi_r2_loader.dll'),
    'shim-orbit'
  );
  await writeFile(path.join(shimDir, 'eax', 'eax.dll'), 'shim-eax');
  return { root, installDir, systemDir, shimDir };
}

describe('launcherless service', () => {
  it('builds native and 32-bit Ubisoft install registry commands', () => {
    const commands = launcherlessRegistryCommands(109, '/games/splinter-cell');

    expect(commands).toHaveLength(4);
    expect(commands[0]).toEqual([
      'reg',
      'add',
      'HKLM\\SOFTWARE\\Ubisoft\\Launcher\\Installs\\109',
      '/v',
      'InstallDir',
      '/t',
      'REG_SZ',
      '/d',
      'Z:\\games\\splinter-cell\\',
      '/f'
    ]);
    expect(commands[1]?.[2]).toContain('Wow6432Node');
  });

  it('preserves a game-supplied EAX DLL in a reversible R1 deployment', async () => {
    const fixture = await createFixture();
    const plan = await inspectLauncherlessPlan(
      fixture.installDir,
      path.join(fixture.systemDir, 'game.exe'),
      fixture.shimDir
    );

    expect(plan.drm).toBe('uplay-r1');
    expect(
      plan.deployments.map((entry) => path.basename(entry.destinationPath))
    ).toEqual([
      'uplay_r1_loader.dll',
      'uplay_r1_loader64.dll',
      'ubiorbitapi_r1_loader64.dll'
    ]);
    expect(
      plan.deployments.every((entry) => /^[a-f0-9]{64}$/.test(entry.sha256))
    ).toBe(true);

    await deployLauncherlessShims(plan);
    expect(
      await readFile(
        path.join(fixture.systemDir, 'uplay_r1_loader.dll'),
        'utf8'
      )
    ).toBe('shim-r1-32');
    expect(
      await readFile(
        path.join(fixture.systemDir, 'uplay_r1_loader.dll.ubi-original'),
        'utf8'
      )
    ).toBe('original-r1');

    await deployLauncherlessShims(plan);
    expect(await restoreLauncherlessInstall(fixture.installDir)).toBe(3);
    expect(
      await readFile(
        path.join(fixture.systemDir, 'uplay_r1_loader.dll'),
        'utf8'
      )
    ).toBe('original-r1');
    expect(
      await readFile(path.join(fixture.systemDir, 'eax.dll'), 'utf8')
    ).toBe('original-eax');
  });

  it('deploys the EAX fallback only when the executable needs it and none exists', async () => {
    const fixture = await createFixture();
    await rm(path.join(fixture.systemDir, 'eax.dll'));
    await writeFile(
      path.join(fixture.systemDir, 'game.exe'),
      Buffer.from('MZ...uplay_r1_loader.dll...EAXDirectSoundCreate8...')
    );

    const plan = await inspectLauncherlessPlan(
      fixture.installDir,
      path.join(fixture.systemDir, 'game.exe'),
      fixture.shimDir
    );

    expect(
      plan.deployments.map((entry) => path.basename(entry.destinationPath))
    ).toContain('eax.dll');
  });

  it('writes ticket profiles without a real password and removes them after launch', async () => {
    const fixture = await createFixture();
    await writeFile(
      path.join(fixture.systemDir, 'Uplay.ini'),
      'original-profile'
    );
    const plan = await inspectLauncherlessPlan(
      fixture.installDir,
      path.join(fixture.systemDir, 'game.exe'),
      fixture.shimDir
    );
    await writeLauncherlessProfiles(
      plan,
      {
        game: {
          title: 'Owned Test Game',
          demuxProductId: 109,
          owned: true,
          state: 3,
          productType: 0,
          productAssociations: [],
          branches: [],
          hasDownloadManifest: true,
          hasConfiguration: true
        },
        userId: 'account-id',
        username: 'Player',
        email: 'player@example.test',
        uplayPcTicket: 'real-game-ticket',
        appId: 77,
        ticketSource: 'ubisoft',
        profilePassword: 'UBI_CLI_AUTHENTICATED'
      },
      fixture.systemDir
    );

    const iniPath = path.join(fixture.systemDir, 'Uplay.ini');
    const ini = await readFile(iniPath, 'utf8');
    const toml = await readFile(
      path.join(fixture.systemDir, 'Uplay.toml'),
      'utf8'
    );
    expect(ini).toContain('IsAppOwned=1');
    expect(ini).toContain('TickedId=real-game-ticket');
    expect(ini).toContain('Password=UBI_CLI_AUTHENTICATED');
    expect(toml).toContain('Ticket = "real-game-ticket"');
    expect(toml).toContain('Password = "UBI_CLI_AUTHENTICATED"');
    expect((await stat(iniPath)).mode & 0o777).toBe(0o600);

    await cleanupLauncherlessProfiles(fixture.installDir);
    expect(await readFile(iniPath, 'utf8')).toBe('original-profile');
  });

  it('refuses to restore a deployed shim that was modified after deployment', async () => {
    const fixture = await createFixture();
    const plan = await inspectLauncherlessPlan(
      fixture.installDir,
      path.join(fixture.systemDir, 'game.exe'),
      fixture.shimDir
    );
    await deployLauncherlessShims(plan);
    const modified = Buffer.from('locally-modified');
    await writeFile(
      path.join(fixture.systemDir, 'uplay_r1_loader.dll'),
      modified
    );

    await expect(
      restoreLauncherlessInstall(fixture.installDir)
    ).rejects.toThrow(/modified shim/);
    expect(
      await readFile(
        path.join(fixture.systemDir, 'uplay_r1_loader.dll'),
        'utf8'
      )
    ).toBe('locally-modified');
    expect(
      await readFile(path.join(fixture.systemDir, 'eax.dll'), 'utf8')
    ).toBe('original-eax');
  });
});
