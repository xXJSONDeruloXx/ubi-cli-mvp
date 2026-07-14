import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import {
  chmod,
  cp,
  lstat,
  mkdir,
  open,
  opendir,
  realpath,
  rename,
  rm,
  writeFile
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { UserFacingError } from '../util/errors';
import { findUbisoftConnectExecutable } from './ubisoft-connect';

const execFileAsync = promisify(execFile);

export interface ConnectPrefixCloneResult {
  sourcePrefix: string;
  targetPrefix: string;
  reflinkRequired: boolean;
}

export interface ConnectAuthenticationMigrationResult {
  sourcePrefix: string;
  targetPrefix: string;
  appDataMigrated: true;
  machineGuidMigrated: true;
}

async function validateExistingPrefix(
  candidate: string,
  label: 'source' | 'target'
): Promise<string> {
  const resolved = path.resolve(candidate);
  const [prefixStats, canonical] = await Promise.all([
    lstat(resolved).catch(() => undefined),
    realpath(resolved).catch(() => undefined)
  ]);
  const currentUid = process.getuid?.();
  if (
    !prefixStats?.isDirectory() ||
    prefixStats.isSymbolicLink() ||
    canonical !== resolved ||
    (currentUid !== undefined && prefixStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      `${label === 'source' ? 'Source' : 'Target'} prefix must be an existing, user-owned real directory: ${resolved}`
    );
  }
  const clientExecutable = await findUbisoftConnectExecutable(resolved);
  const clientStats = clientExecutable
    ? await lstat(clientExecutable).catch(() => undefined)
    : undefined;
  if (
    !clientExecutable ||
    !clientStats?.isFile() ||
    clientStats.isSymbolicLink()
  ) {
    throw new UserFacingError(
      `Ubisoft Connect is not safely installed in the ${label} prefix: ${resolved}`
    );
  }
  await assertSafeDirectoryChain(resolved, path.dirname(clientExecutable));
  return resolved;
}

async function assertSafeDirectoryChain(
  root: string,
  directory: string
): Promise<void> {
  const resolvedRoot = path.resolve(root);
  const resolvedDirectory = path.resolve(directory);
  const relative = path.relative(resolvedRoot, resolvedDirectory);
  if (
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserFacingError(
      'Authentication migration path escaped its prefix.'
    );
  }

  let current = resolvedRoot;
  for (const segment of relative ? relative.split(path.sep) : []) {
    current = path.join(current, segment);
    const stats = await lstat(current).catch(() => undefined);
    if (!stats?.isDirectory() || stats.isSymbolicLink()) {
      throw new UserFacingError(
        `Authentication migration requires real directory ancestors: ${current}`
      );
    }
  }
}

async function assertConnectStopped(
  prefix: string,
  runner: string,
  runnerArgs: string[] = []
): Promise<void> {
  let stdout: string;
  try {
    const result = await execFileAsync(runner, [...runnerArgs, 'tasklist'], {
      env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all' },
      encoding: 'utf8'
    });
    stdout = result.stdout;
  } catch (error) {
    throw new UserFacingError(
      `Could not verify that Connect is stopped before copying authentication state: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (
    /\b(?:upc|UbisoftConnect|UbisoftGameLauncher(?:64)?|UbisoftExtension|UplayWebCore|UplayService|UpcElevationService|UplayCrashReporter|SharePlayClient)\.exe\b/i.test(
      stdout
    )
  ) {
    throw new UserFacingError(
      `Ubisoft Connect is running in the ${prefix} prefix. Fully exit it before copying authentication state.`
    );
  }
}

function winePathToHostPath(prefix: string, windowsPath: string): string {
  const normalized = windowsPath.trim().replaceAll('\\', '/');
  const match = /^c:\/(.*)$/i.exec(normalized);
  if (!match?.[1]) {
    throw new UserFacingError(
      'Wine returned a Local AppData path outside the selected prefix.'
    );
  }
  const driveRoot = path.resolve(prefix, 'drive_c');
  const resolved = path.resolve(driveRoot, ...match[1].split('/'));
  const relative = path.relative(driveRoot, resolved);
  if (
    !relative ||
    relative === '..' ||
    relative.startsWith(`..${path.sep}`) ||
    path.isAbsolute(relative)
  ) {
    throw new UserFacingError(
      'Wine returned a Local AppData path outside the selected prefix.'
    );
  }
  return resolved;
}

async function resolveConnectAppData(
  prefix: string,
  runner: string,
  runnerArgs: string[]
): Promise<string> {
  let stdout: string;
  try {
    const result = await execFileAsync(
      runner,
      [...runnerArgs, 'cmd', '/d', '/s', '/c', 'echo %LOCALAPPDATA%'],
      {
        env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all' },
        encoding: 'utf8'
      }
    );
    stdout = result.stdout;
  } catch {
    throw new UserFacingError(
      'Could not resolve Wine Local AppData for authentication migration.'
    );
  }
  const windowsPath = stdout
    .split(/\r?\n/)
    .map((value) => value.trim())
    .find((value) => /^[a-z]:[\\/]/i.test(value));
  if (!windowsPath) {
    throw new UserFacingError(
      'Wine did not return a usable Local AppData path for authentication migration.'
    );
  }
  return path.join(
    winePathToHostPath(prefix, windowsPath),
    'Ubisoft Game Launcher'
  );
}

async function assertTreeHasNoSymlinks(current: string): Promise<void> {
  const currentStats = await lstat(current);
  if (currentStats.isSymbolicLink()) {
    throw new UserFacingError(
      `Refusing to migrate Connect authentication through a symlink: ${current}`
    );
  }
  if (!currentStats.isDirectory()) {
    return;
  }
  const directory = await opendir(current);
  for await (const entry of directory) {
    await assertTreeHasNoSymlinks(path.join(current, entry.name));
  }
}

async function readMachineGuid(
  prefix: string,
  runner: string,
  runnerArgs: string[]
): Promise<string> {
  try {
    const result = await execFileAsync(
      runner,
      [
        ...runnerArgs,
        'reg',
        'query',
        'HKLM\\Software\\Microsoft\\Cryptography',
        '/v',
        'MachineGuid'
      ],
      {
        env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all' },
        encoding: 'utf8'
      }
    );
    const value = /^\s*MachineGuid\s+REG_SZ\s+([^\r\n]+)$/im.exec(
      result.stdout
    )?.[1];
    if (
      !value ||
      !/^[{]?[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}[}]?$/i.test(
        value.trim()
      )
    ) {
      throw new Error('malformed');
    }
    return value.trim();
  } catch {
    throw new UserFacingError(
      'Could not read a valid Wine device identifier for authentication migration.'
    );
  }
}

async function acquirePrefixLocks(
  prefixes: string[]
): Promise<() => Promise<void>> {
  const lockPaths = [
    ...new Set(
      prefixes.map((prefix) =>
        path.join(
          path.dirname(prefix),
          `.${path.basename(prefix)}.connect-auth.lock`
        )
      )
    )
  ].sort();
  const acquired: Array<{
    lockPath: string;
    handle: Awaited<ReturnType<typeof open>>;
  }> = [];

  try {
    for (const lockPath of lockPaths) {
      const handle = await open(lockPath, 'wx', 0o600);
      acquired.push({ lockPath, handle });
      await handle.writeFile(`${process.pid}\n`);
    }
  } catch (error) {
    for (const lock of acquired.reverse()) {
      await lock.handle.close().catch(() => undefined);
      await rm(lock.lockPath, { force: true });
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UserFacingError(
        'Another authentication migration or prefix clone may be using one of the selected prefixes. If a previous process crashed, verify that no migration, clone, or Wine process remains before removing its adjacent owner-only .connect-auth.lock file.'
      );
    }
    throw new UserFacingError(
      'Could not lock the selected prefixes for authentication migration.'
    );
  }

  return async () => {
    for (const lock of acquired.reverse()) {
      try {
        await lock.handle.close();
      } finally {
        await rm(lock.lockPath, { force: true });
      }
    }
  };
}

async function writeMachineGuid(
  prefix: string,
  machineGuid: string,
  runner: string,
  runnerArgs: string[]
): Promise<void> {
  const registryFile = path.join(
    prefix,
    `.connect-machine-guid.${process.pid}.${randomUUID()}.reg`
  );
  try {
    await writeFile(
      registryFile,
      [
        'REGEDIT4',
        '',
        '[HKEY_LOCAL_MACHINE\\Software\\Microsoft\\Cryptography]',
        `"MachineGuid"="${machineGuid}"`,
        ''
      ].join('\r\n'),
      { encoding: 'ascii', flag: 'wx', mode: 0o600 }
    );
    await execFileAsync(
      runner,
      [...runnerArgs, 'reg', 'import', registryFile],
      {
        env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all' },
        encoding: 'utf8'
      }
    );
  } catch {
    throw new UserFacingError(
      'Could not update the target Wine device identifier; authentication migration was rolled back.'
    );
  } finally {
    await rm(registryFile, { force: true });
  }
}

export async function cloneConnectPrefix(
  sourcePrefix: string,
  targetPrefix: string,
  options: {
    runner?: string;
    runnerArgs?: string[];
    reflinkOnly?: boolean;
    skipProcessCheck?: boolean;
  } = {}
): Promise<ConnectPrefixCloneResult> {
  const source = await validateExistingPrefix(sourcePrefix, 'source');
  const target = path.resolve(targetPrefix);
  if (source === target || target.startsWith(`${source}${path.sep}`)) {
    throw new UserFacingError(
      'Target prefix must be separate from and outside the source prefix.'
    );
  }
  const targetStats = await lstat(target).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  if (targetStats) {
    throw new UserFacingError(
      `Target prefix already exists; refusing to merge authentication state: ${target}`
    );
  }
  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const [parentStats, canonicalParent] = await Promise.all([
    lstat(parent),
    realpath(parent)
  ]);
  const currentUid = process.getuid?.();
  if (
    !parentStats.isDirectory() ||
    parentStats.isSymbolicLink() ||
    canonicalParent !== parent ||
    (currentUid !== undefined && parentStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      'Target prefix parent must be a user-owned real directory.'
    );
  }

  const temporary = path.join(
    parent,
    `.${path.basename(target)}.${process.pid}.partial`
  );
  const releaseLocks = await acquirePrefixLocks([source, target]);
  try {
    if (!options.skipProcessCheck) {
      await assertConnectStopped(
        source,
        options.runner ?? 'wine',
        options.runnerArgs
      );
    }
    await rm(temporary, { recursive: true, force: true });
    try {
      await cp(source, temporary, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
        mode: options.reflinkOnly
          ? constants.COPYFILE_FICLONE_FORCE
          : constants.COPYFILE_FICLONE
      });
      await chmod(temporary, 0o700);
      if (!options.skipProcessCheck) {
        await assertConnectStopped(
          source,
          options.runner ?? 'wine',
          options.runnerArgs
        );
      }
      if (!(await findUbisoftConnectExecutable(temporary))) {
        throw new UserFacingError(
          'Cloned prefix is incomplete: UbisoftConnect.exe is missing.'
        );
      }
      await rename(temporary, target);
    } catch (error) {
      await rm(temporary, { recursive: true, force: true });
      if (
        options.reflinkOnly &&
        error instanceof Error &&
        !(error instanceof UserFacingError)
      ) {
        throw new UserFacingError(
          `Secure reflink clone failed without falling back to a full copy: ${error.message}`
        );
      }
      throw error;
    }

    return {
      sourcePrefix: source,
      targetPrefix: target,
      reflinkRequired: Boolean(options.reflinkOnly)
    };
  } finally {
    await releaseLocks();
  }
}

export async function migrateConnectAuthentication(
  sourcePrefix: string,
  targetPrefix: string,
  options: {
    runner?: string;
    runnerArgs?: string[];
    skipProcessCheck?: boolean;
  } = {}
): Promise<ConnectAuthenticationMigrationResult> {
  const source = await validateExistingPrefix(sourcePrefix, 'source');
  const target = await validateExistingPrefix(targetPrefix, 'target');
  if (
    source === target ||
    source.startsWith(`${target}${path.sep}`) ||
    target.startsWith(`${source}${path.sep}`)
  ) {
    throw new UserFacingError(
      'Authentication migration requires separate, non-nested source and target prefixes.'
    );
  }
  const runner = options.runner ?? 'wine';
  const runnerArgs = options.runnerArgs ?? [];
  const releaseLocks = await acquirePrefixLocks([source, target]);
  try {
    if (!options.skipProcessCheck) {
      await assertConnectStopped(source, runner, runnerArgs);
      await assertConnectStopped(target, runner, runnerArgs);
    }
    await chmod(target, 0o700);

    const [sourceAppData, targetAppData, sourceMachineGuid, targetMachineGuid] =
      await Promise.all([
        resolveConnectAppData(source, runner, runnerArgs),
        resolveConnectAppData(target, runner, runnerArgs),
        readMachineGuid(source, runner, runnerArgs),
        readMachineGuid(target, runner, runnerArgs)
      ]);
    const sourceStats = await lstat(sourceAppData).catch(() => undefined);
    if (!sourceStats?.isDirectory() || sourceStats.isSymbolicLink()) {
      throw new UserFacingError(
        'The source prefix has no real Ubisoft Connect AppData profile to migrate.'
      );
    }
    await assertSafeDirectoryChain(source, sourceAppData);
    await assertTreeHasNoSymlinks(sourceAppData);
    for (const requiredFile of ['ConnectSecureStorage.dat', 'user.dat']) {
      const requiredStats = await lstat(
        path.join(sourceAppData, requiredFile)
      ).catch(() => undefined);
      if (!requiredStats?.isFile() || requiredStats.isSymbolicLink()) {
        throw new UserFacingError(
          `The source Connect profile is missing required opaque client state: ${requiredFile}`
        );
      }
    }

    const targetParent = path.dirname(targetAppData);
    await assertSafeDirectoryChain(target, targetParent);
    const targetParentStats = await lstat(targetParent).catch(() => undefined);
    const currentUid = process.getuid?.();
    if (
      !targetParentStats?.isDirectory() ||
      targetParentStats.isSymbolicLink() ||
      (currentUid !== undefined && targetParentStats.uid !== currentUid)
    ) {
      throw new UserFacingError(
        'Target Local AppData parent must be an existing, user-owned real directory.'
      );
    }

    const suffix = `${process.pid}.${randomUUID()}`;
    const temporary = path.join(
      targetParent,
      `.${path.basename(targetAppData)}.${suffix}.partial`
    );
    const backup = path.join(
      targetParent,
      `.${path.basename(targetAppData)}.${suffix}.backup`
    );
    await rm(temporary, { recursive: true, force: true });
    await rm(backup, { recursive: true, force: true });

    let targetBackedUp = false;
    let published = false;
    try {
      await cp(sourceAppData, temporary, {
        recursive: true,
        preserveTimestamps: true,
        verbatimSymlinks: true,
        mode: constants.COPYFILE_FICLONE
      });
      await assertTreeHasNoSymlinks(temporary);
      await chmod(temporary, 0o700);
      if (!options.skipProcessCheck) {
        await assertConnectStopped(source, runner, runnerArgs);
        await assertConnectStopped(target, runner, runnerArgs);
      }

      const existingTarget = await lstat(targetAppData).catch(() => undefined);
      if (existingTarget) {
        if (!existingTarget.isDirectory() || existingTarget.isSymbolicLink()) {
          throw new UserFacingError(
            'Target Connect AppData must be a real directory when present.'
          );
        }
        await rename(targetAppData, backup);
        targetBackedUp = true;
      }
      await rename(temporary, targetAppData);
      published = true;
      if (!options.skipProcessCheck) {
        await assertConnectStopped(target, runner, runnerArgs);
      }

      await writeMachineGuid(target, sourceMachineGuid, runner, runnerArgs);
      const verifiedMachineGuid = await readMachineGuid(
        target,
        runner,
        runnerArgs
      );
      if (verifiedMachineGuid !== sourceMachineGuid) {
        throw new UserFacingError(
          'Target Wine device identifier verification failed; authentication migration was rolled back.'
        );
      }
    } catch (error) {
      if (published && !options.skipProcessCheck) {
        try {
          await assertConnectStopped(target, runner, runnerArgs);
        } catch {
          throw new UserFacingError(
            targetBackedUp
              ? `Connect started during authentication migration. No rollback was attempted against the live prefix. Fully stop Connect, remove ${targetAppData}, and restore the owner-only backup at ${backup} before retrying.`
              : `Connect started during authentication migration. No rollback was attempted against the live prefix. Fully stop Connect and remove the incomplete AppData at ${targetAppData} before retrying.`
          );
        }
      }

      let rollbackIncomplete = false;
      if (published) {
        await rm(targetAppData, { recursive: true, force: true }).catch(() => {
          rollbackIncomplete = true;
        });
      }
      if (targetBackedUp) {
        await rename(backup, targetAppData).catch(() => {
          rollbackIncomplete = true;
        });
      }
      await writeMachineGuid(
        target,
        targetMachineGuid,
        runner,
        runnerArgs
      ).catch(() => {
        rollbackIncomplete = true;
      });
      await rm(temporary, { recursive: true, force: true }).catch(() => {
        rollbackIncomplete = true;
      });
      if (rollbackIncomplete) {
        throw new UserFacingError(
          'Authentication migration failed and automatic rollback was incomplete. Keep the target prefix stopped and restore it from backup before reuse.'
        );
      }
      throw error;
    }

    if (targetBackedUp) {
      await rm(backup, { recursive: true, force: true }).catch(() => {
        throw new UserFacingError(
          'Authentication migration succeeded, but the previous target AppData backup could not be removed. The target is valid; keep both prefixes stopped and remove the hidden backup before reuse.'
        );
      });
    }

    return {
      sourcePrefix: source,
      targetPrefix: target,
      appDataMigrated: true,
      machineGuidMigrated: true
    };
  } finally {
    await releaseLocks();
  }
}
