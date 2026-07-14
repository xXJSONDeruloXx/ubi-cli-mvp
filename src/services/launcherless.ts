import { createHash, randomUUID } from 'node:crypto';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  realpath,
  rename,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import type { LauncherlessAccount } from './demux-service';
import { UserFacingError } from '../util/errors';

export type LauncherlessDrm = 'uplay-r1' | 'orbit-r2';

interface DeploymentRecord {
  relativePath: string;
  backupRelativePath?: string;
  originalSha256?: string;
  shimSha256: string;
}

export interface LauncherlessState {
  version: 1;
  drm: LauncherlessDrm;
  shimRoot: string;
  deployments: DeploymentRecord[];
}

interface ProfileRecord {
  relativePath: string;
  backupRelativePath?: string;
  originalSha256?: string;
  sha256: string;
}

interface LauncherlessProfileState {
  version: 1;
  profiles: ProfileRecord[];
}

export interface LauncherlessDeployment {
  sourcePath: string;
  destinationPath: string;
  relativePath: string;
  sha256: string;
}

export interface LauncherlessPlan {
  installDir: string;
  executable: string;
  executableDirectory: string;
  drm: LauncherlessDrm;
  shimRoot: string;
  deployments: LauncherlessDeployment[];
  statePath: string;
}

const STATE_FILE = '.ubi-launcherless-state.json';
const PROFILE_STATE_FILE = '.ubi-launcherless-session.json';

function sha256(body: Buffer): string {
  return createHash('sha256').update(body).digest('hex');
}

async function atomicWrite(
  filePath: string,
  body: Buffer | string,
  mode: number
): Promise<void> {
  const temporary = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${randomUUID()}.partial`
  );
  const handle = await open(temporary, 'wx', mode);
  try {
    await handle.writeFile(body);
    await handle.sync();
  } finally {
    await handle.close();
  }
  try {
    await rename(temporary, filePath);
    await chmod(filePath, mode);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

function resolveContained(root: string, relativePath: string): string {
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, relativePath);
  if (
    resolved !== resolvedRoot &&
    !resolved.startsWith(`${resolvedRoot}${path.sep}`)
  ) {
    throw new UserFacingError(
      `Launcherless path escapes the install directory: ${relativePath}`
    );
  }
  return resolved;
}

async function assertRealDirectory(
  directory: string,
  label: string
): Promise<string> {
  const resolved = path.resolve(directory);
  const [stats, canonical] = await Promise.all([
    lstat(resolved).catch(() => undefined),
    realpath(resolved).catch(() => undefined)
  ]);
  if (
    !stats?.isDirectory() ||
    stats.isSymbolicLink() ||
    canonical !== resolved
  ) {
    throw new UserFacingError(
      `${label} must be a real, non-symlink directory: ${resolved}`
    );
  }
  return resolved;
}

async function readRegularFile(
  filePath: string,
  label: string
): Promise<Buffer> {
  const stats = await lstat(filePath).catch(() => undefined);
  if (!stats?.isFile() || stats.isSymbolicLink()) {
    throw new UserFacingError(
      `${label} must be a regular non-symlink file: ${filePath}`
    );
  }
  return readFile(filePath);
}

function containsAscii(body: Buffer, value: string): boolean {
  return body.toString('latin1').toLowerCase().includes(value.toLowerCase());
}

export function detectLauncherlessDrm(executableBody: Buffer): LauncherlessDrm {
  return containsAscii(executableBody, 'ubiorbitapi_r2_loader')
    ? 'orbit-r2'
    : 'uplay-r1';
}

export async function inspectLauncherlessPlan(
  installDir: string,
  executable: string,
  shimRoot: string
): Promise<LauncherlessPlan> {
  const root = await assertRealDirectory(installDir, 'Install directory');
  const resolvedExecutable = resolveContained(
    root,
    path.relative(root, path.resolve(executable))
  );
  const executableBody = await readRegularFile(
    resolvedExecutable,
    'Game executable'
  );
  const resolvedShimRoot = await assertRealDirectory(shimRoot, 'Shim root');
  const drm = detectLauncherlessDrm(executableBody);
  const executableDirectory = path.dirname(resolvedExecutable);
  const specifications: Array<[string, string]> = [
    ['uplay_r1/uplay_r1_loader.dll', 'uplay_r1_loader.dll'],
    ['uplay_r1/uplay_r1_loader64.dll', 'uplay_r1_loader64.dll'],
    ['uplay_r1/uplay_r1_loader64.dll', 'ubiorbitapi_r1_loader64.dll']
  ];
  if (drm === 'orbit-r2') {
    specifications.push(
      ['orbit_r2/ubiorbitapi_r2_loader.dll', 'ubiorbitapi_r2_loader.dll'],
      ['uplay_r1/uplay_r1_loader.dll', 'upc_r1_loader.dll']
    );
  }

  const existingEax = await lstat(
    path.join(executableDirectory, 'eax.dll')
  ).catch(() => undefined);
  // Preserve a game-supplied EAX implementation. The compatibility stub is a
  // fallback only; replacing a fuller native DLL can remove ordinal exports.
  if (!existingEax && containsAscii(executableBody, 'EAXDirectSound')) {
    specifications.push(['eax/eax.dll', 'eax.dll']);
  }

  const deployments: LauncherlessDeployment[] = [];
  for (const [sourceRelative, destinationName] of specifications) {
    const sourcePath = resolveContained(resolvedShimRoot, sourceRelative);
    const body = await readRegularFile(sourcePath, 'Shim');
    const destinationPath = resolveContained(
      root,
      path.relative(root, path.join(executableDirectory, destinationName))
    );
    deployments.push({
      sourcePath,
      destinationPath,
      relativePath: path.relative(root, destinationPath),
      sha256: sha256(body)
    });
  }

  return {
    installDir: root,
    executable: resolvedExecutable,
    executableDirectory,
    drm,
    shimRoot: resolvedShimRoot,
    deployments,
    statePath: path.join(root, STATE_FILE)
  };
}

async function loadState(root: string): Promise<LauncherlessState | undefined> {
  const statePath = path.join(root, STATE_FILE);
  const stats = await lstat(statePath).catch(() => undefined);
  if (!stats) return undefined;
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024 * 1024) {
    throw new UserFacingError(`Unsafe launcherless state file: ${statePath}`);
  }
  const parsed = JSON.parse(
    await readFile(statePath, 'utf8')
  ) as LauncherlessState;
  if (parsed.version !== 1 || !Array.isArray(parsed.deployments)) {
    throw new UserFacingError(
      `Unsupported launcherless state file: ${statePath}`
    );
  }
  return parsed;
}

export async function deployLauncherlessShims(
  plan: LauncherlessPlan
): Promise<LauncherlessState> {
  const existingState = await loadState(plan.installDir);
  if (existingState) {
    if (existingState.deployments.length !== plan.deployments.length) {
      throw new UserFacingError(
        'Launcherless shim selection changed; restore it before changing executables or shim bundles.'
      );
    }
    for (const deployment of plan.deployments) {
      const record = existingState.deployments.find(
        (entry) => entry.relativePath === deployment.relativePath
      );
      const current = await readRegularFile(
        deployment.destinationPath,
        'Deployed shim'
      );
      if (
        !record ||
        record.shimSha256 !== deployment.sha256 ||
        sha256(current) !== deployment.sha256
      ) {
        throw new UserFacingError(
          `Launcherless shim state differs at ${deployment.relativePath}; restore it before changing shim bundles.`
        );
      }
    }
    return existingState;
  }

  const records: DeploymentRecord[] = [];
  try {
    for (const deployment of plan.deployments) {
      const destinationStats = await lstat(deployment.destinationPath).catch(
        () => undefined
      );
      if (
        destinationStats?.isSymbolicLink() ||
        (destinationStats && !destinationStats.isFile())
      ) {
        throw new UserFacingError(
          `Refusing to replace unsafe launcher file: ${deployment.destinationPath}`
        );
      }
      const record: DeploymentRecord = {
        relativePath: deployment.relativePath,
        shimSha256: deployment.sha256
      };
      if (destinationStats) {
        const original = await readFile(deployment.destinationPath);
        const backupPath = `${deployment.destinationPath}.ubi-original`;
        if (await lstat(backupPath).catch(() => undefined)) {
          throw new UserFacingError(
            `Launcher backup already exists: ${backupPath}`
          );
        }
        await rename(deployment.destinationPath, backupPath);
        record.backupRelativePath = path.relative(plan.installDir, backupPath);
        record.originalSha256 = sha256(original);
      }
      records.push(record);
      await atomicWrite(
        deployment.destinationPath,
        await readFile(deployment.sourcePath),
        0o600
      );
    }
    const state: LauncherlessState = {
      version: 1,
      drm: plan.drm,
      shimRoot: plan.shimRoot,
      deployments: records
    };
    await atomicWrite(
      plan.statePath,
      `${JSON.stringify(state, null, 2)}\n`,
      0o600
    );
    return state;
  } catch (error) {
    for (const record of [...records].reverse()) {
      const destination = resolveContained(
        plan.installDir,
        record.relativePath
      );
      await rm(destination, { force: true });
      if (record.backupRelativePath) {
        await rename(
          resolveContained(plan.installDir, record.backupRelativePath),
          destination
        ).catch(() => undefined);
      }
    }
    throw error;
  }
}

function cleanProfileValue(value: string): string {
  if (/[\r\n\0]/.test(value)) {
    throw new UserFacingError(
      'Launcherless profile values may not contain control characters.'
    );
  }
  return value;
}

function tomlString(value: string): string {
  return JSON.stringify(cleanProfileValue(value));
}

function createProfiles(
  account: LauncherlessAccount,
  title: string,
  drm: LauncherlessDrm
): Record<string, string> {
  const ini = [
    '[Uplay]',
    'IsAppOwned=1',
    'UplayConnection=0',
    `AppId=${account.appId}`,
    `Username=${cleanProfileValue(account.username)}`,
    `Email=${cleanProfileValue(account.email)}`,
    `Password=${cleanProfileValue(account.profilePassword)}`,
    'Language=en-US',
    'CdKey=',
    `UserId=${cleanProfileValue(account.userId)}`,
    `TickedId=${cleanProfileValue(account.uplayPcTicket)}`,
    'SavePath=Default',
    ''
  ].join('\r\n');
  const uplayToml = [
    '[Uplay]',
    `Name = ${tomlString(title)}`,
    'Saves = "Saves"',
    'CdKeys = [""]',
    'Language = "en-US"',
    'OfflineMode = true',
    'InstallHooks = false',
    '',
    '[Uplay.Log]',
    'Write = true',
    'Path = "Uplay.log"',
    '',
    '[Uplay.Profile]',
    `AccountId = ${tomlString(account.userId)}`,
    `Email = ${tomlString(account.email)}`,
    `Username = ${tomlString(account.username)}`,
    `Password = ${tomlString(account.profilePassword)}`,
    `Ticket = ${tomlString(account.uplayPcTicket)}`,
    ''
  ].join('\n');
  const profiles: Record<string, string> = {
    'Uplay.ini': ini,
    'Uplay.toml': uplayToml
  };
  if (drm === 'orbit-r2') {
    profiles['Orbit.toml'] = [
      '[Orbit]',
      `Name = ${tomlString(title)}`,
      `ProductId = ${account.appId}`,
      'Saves = "Saves"',
      'CdKeys = [""]',
      '',
      '[Orbit.Log]',
      'Write = true',
      'Path = "Orbit.log"',
      '',
      '[Orbit.Profile]',
      `AccountId = ${tomlString(account.userId)}`,
      `Username = ${tomlString(account.username)}`,
      `Password = ${tomlString(account.profilePassword)}`,
      ''
    ].join('\n');
  }
  return profiles;
}

export async function cleanupLauncherlessProfiles(
  installDir: string
): Promise<void> {
  const root = path.resolve(installDir);
  const statePath = path.join(root, PROFILE_STATE_FILE);
  const stats = await lstat(statePath).catch(() => undefined);
  if (!stats) return;
  if (!stats.isFile() || stats.isSymbolicLink() || stats.size > 1024 * 1024) {
    throw new UserFacingError(
      `Unsafe launcherless session state: ${statePath}`
    );
  }
  const state = JSON.parse(
    await readFile(statePath, 'utf8')
  ) as LauncherlessProfileState;
  if (state.version !== 1 || !Array.isArray(state.profiles)) {
    throw new UserFacingError(
      `Unsupported launcherless session state: ${statePath}`
    );
  }
  for (const record of state.profiles) {
    const destination = resolveContained(root, record.relativePath);
    const current = await lstat(destination).catch(() => undefined);
    if (current) {
      const body = await readRegularFile(destination, 'Launcherless profile');
      if (sha256(body) !== record.sha256) {
        throw new UserFacingError(
          `Refusing to remove modified launcherless profile: ${destination}`
        );
      }
    }
    if (record.backupRelativePath) {
      const backup = resolveContained(root, record.backupRelativePath);
      const original = await readRegularFile(
        backup,
        'Launcherless profile backup'
      );
      if (record.originalSha256 && sha256(original) !== record.originalSha256) {
        throw new UserFacingError(
          `Launcherless profile backup hash changed: ${backup}`
        );
      }
    }
  }
  for (const record of [...state.profiles].reverse()) {
    const destination = resolveContained(root, record.relativePath);
    const current = await lstat(destination).catch(() => undefined);
    if (current) {
      await rm(destination);
    }
    if (record.backupRelativePath) {
      await rename(
        resolveContained(root, record.backupRelativePath),
        destination
      );
    }
  }
  await rm(statePath);
}

export async function writeLauncherlessProfiles(
  plan: LauncherlessPlan,
  account: LauncherlessAccount,
  workingDirectory: string
): Promise<void> {
  await cleanupLauncherlessProfiles(plan.installDir);
  const directories = [
    ...new Set([plan.executableDirectory, path.resolve(workingDirectory)])
  ];
  const profiles = createProfiles(account, account.game.title, plan.drm);
  const records: ProfileRecord[] = [];
  try {
    for (const directory of directories) {
      await mkdir(path.join(directory, 'Saves'), {
        recursive: true,
        mode: 0o700
      });
      for (const [name, content] of Object.entries(profiles)) {
        const destination = resolveContained(
          plan.installDir,
          path.relative(plan.installDir, path.join(directory, name))
        );
        const record: ProfileRecord = {
          relativePath: path.relative(plan.installDir, destination),
          sha256: sha256(Buffer.from(content))
        };
        const existing = await lstat(destination).catch(() => undefined);
        if (existing) {
          const original = await readRegularFile(
            destination,
            'Existing launcher profile'
          );
          const backup = `${destination}.ubi-session-original`;
          if (await lstat(backup).catch(() => undefined)) {
            throw new UserFacingError(
              `Launcherless profile backup already exists: ${backup}`
            );
          }
          await rename(destination, backup);
          record.backupRelativePath = path.relative(plan.installDir, backup);
          record.originalSha256 = sha256(original);
        }
        records.push(record);
        await atomicWrite(destination, content, 0o600);
      }
    }
    const state: LauncherlessProfileState = { version: 1, profiles: records };
    await atomicWrite(
      path.join(plan.installDir, PROFILE_STATE_FILE),
      `${JSON.stringify(state, null, 2)}\n`,
      0o600
    );
  } catch (error) {
    for (const record of [...records].reverse()) {
      const destination = resolveContained(
        plan.installDir,
        record.relativePath
      );
      await rm(destination, { force: true });
      if (record.backupRelativePath) {
        await rename(
          resolveContained(plan.installDir, record.backupRelativePath),
          destination
        ).catch(() => undefined);
      }
    }
    throw error;
  }
}

export async function restoreLauncherlessInstall(
  installDir: string
): Promise<number> {
  const root = await assertRealDirectory(installDir, 'Install directory');
  await cleanupLauncherlessProfiles(root);
  const state = await loadState(root);
  if (!state) return 0;
  for (const record of state.deployments) {
    const destination = resolveContained(root, record.relativePath);
    const current = await readRegularFile(destination, 'Deployed shim');
    if (sha256(current) !== record.shimSha256) {
      throw new UserFacingError(
        `Refusing to restore over a modified shim: ${destination}`
      );
    }
    if (record.backupRelativePath) {
      const backup = resolveContained(root, record.backupRelativePath);
      const original = await readRegularFile(backup, 'Launcher backup');
      if (record.originalSha256 && sha256(original) !== record.originalSha256) {
        throw new UserFacingError(`Launcher backup hash changed: ${backup}`);
      }
    }
  }
  for (const record of [...state.deployments].reverse()) {
    const destination = resolveContained(root, record.relativePath);
    await rm(destination);
    if (record.backupRelativePath) {
      const backup = resolveContained(root, record.backupRelativePath);
      await rename(backup, destination);
    }
  }
  await rm(path.join(root, STATE_FILE));
  return state.deployments.length;
}
