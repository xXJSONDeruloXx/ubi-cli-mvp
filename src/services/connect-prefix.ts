import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { chmod, cp, lstat, mkdir, rename, rm } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { promisify } from 'node:util';
import { UserFacingError } from '../util/errors';
import { findUbisoftConnectExecutable } from './ubisoft-connect';

const execFileAsync = promisify(execFile);

export interface ConnectPrefixCloneResult {
  sourcePrefix: string;
  targetPrefix: string;
  reflinkRequired: boolean;
}

async function validateSourcePrefix(source: string): Promise<string> {
  const resolved = path.resolve(source);
  const sourceStats = await lstat(resolved).catch(() => undefined);
  const currentUid = process.getuid?.();
  if (
    !sourceStats?.isDirectory() ||
    sourceStats.isSymbolicLink() ||
    (currentUid !== undefined && sourceStats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      `Source prefix must be an existing, user-owned real directory: ${resolved}`
    );
  }
  if (!(await findUbisoftConnectExecutable(resolved))) {
    throw new UserFacingError(
      `Ubisoft Connect is not installed in the source prefix: ${resolved}`
    );
  }
  return resolved;
}

async function assertConnectStopped(
  prefix: string,
  runner: string
): Promise<void> {
  let stdout: string;
  try {
    const result = await execFileAsync(runner, ['tasklist'], {
      env: { ...process.env, WINEPREFIX: prefix, WINEDEBUG: '-all' },
      encoding: 'utf8'
    });
    stdout = result.stdout;
  } catch (error) {
    throw new UserFacingError(
      `Could not verify that Connect is stopped before cloning: ${error instanceof Error ? error.message : String(error)}`
    );
  }
  if (/\bupc\.exe\b/i.test(stdout)) {
    throw new UserFacingError(
      'Ubisoft Connect is running in the source prefix. Fully exit it before cloning authentication state.'
    );
  }
}

export async function cloneConnectPrefix(
  sourcePrefix: string,
  targetPrefix: string,
  options: {
    runner?: string;
    reflinkOnly?: boolean;
    skipProcessCheck?: boolean;
  } = {}
): Promise<ConnectPrefixCloneResult> {
  const source = await validateSourcePrefix(sourcePrefix);
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
  if (!options.skipProcessCheck) {
    await assertConnectStopped(source, options.runner ?? 'wine');
  }

  const parent = path.dirname(target);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const parentStats = await lstat(parent);
  const currentUid = process.getuid?.();
  if (
    !parentStats.isDirectory() ||
    parentStats.isSymbolicLink() ||
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
}
