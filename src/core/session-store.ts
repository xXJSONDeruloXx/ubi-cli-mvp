import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  chmod,
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import type { AppPaths } from '../models/config';
import { UserFacingError } from '../util/errors';

const SESSION_FILE_MODE = 0o600;
const SESSION_DIRECTORY_MODE = 0o700;
const MAX_SESSION_BYTES = 1024 * 1024;

export interface StoredSession {
  ticket: string;
  sessionId: string;
  userId: string;
  profileId?: string;
  nameOnPlatform?: string;
  email?: string;
  expiration?: string;
  rememberMeTicket?: string;
  refreshTime?: number;
}

function validateOptionalString(
  value: unknown,
  field: string
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== 'string') {
    throw new UserFacingError(`Stored Ubisoft session has invalid ${field}.`);
  }
  return value;
}

function validateSession(value: unknown): StoredSession {
  if (typeof value !== 'object' || value === null) {
    throw new UserFacingError('Stored Ubisoft session must be an object.');
  }
  const record = value as Record<string, unknown>;
  for (const field of ['ticket', 'sessionId', 'userId'] as const) {
    if (typeof record[field] !== 'string' || !record[field]) {
      throw new UserFacingError(
        `Stored Ubisoft session is missing required ${field}.`
      );
    }
  }
  if (
    record.refreshTime !== undefined &&
    (typeof record.refreshTime !== 'number' ||
      !Number.isFinite(record.refreshTime))
  ) {
    throw new UserFacingError(
      'Stored Ubisoft session has invalid refreshTime.'
    );
  }

  return {
    ticket: record.ticket as string,
    sessionId: record.sessionId as string,
    userId: record.userId as string,
    ...(validateOptionalString(record.profileId, 'profileId') !== undefined
      ? { profileId: record.profileId as string }
      : {}),
    ...(validateOptionalString(record.nameOnPlatform, 'nameOnPlatform') !==
    undefined
      ? { nameOnPlatform: record.nameOnPlatform as string }
      : {}),
    ...(validateOptionalString(record.email, 'email') !== undefined
      ? { email: record.email as string }
      : {}),
    ...(validateOptionalString(record.expiration, 'expiration') !== undefined
      ? { expiration: record.expiration as string }
      : {}),
    ...(validateOptionalString(record.rememberMeTicket, 'rememberMeTicket') !==
    undefined
      ? { rememberMeTicket: record.rememberMeTicket as string }
      : {}),
    ...(typeof record.refreshTime === 'number'
      ? { refreshTime: record.refreshTime }
      : {})
  };
}

async function validateSessionDirectory(
  directory: string,
  create: boolean
): Promise<void> {
  if (create) {
    await mkdir(directory, {
      recursive: true,
      mode: SESSION_DIRECTORY_MODE
    });
  }
  const [stats, canonical] = await Promise.all([
    lstat(directory).catch(() => undefined),
    realpath(directory).catch(() => undefined)
  ]);
  const currentUid = process.getuid?.();
  if (
    !stats?.isDirectory() ||
    stats.isSymbolicLink() ||
    canonical !== path.resolve(directory) ||
    (currentUid !== undefined && stats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      'Ubisoft session directory must be a user-owned real directory without symlink aliases.'
    );
  }
  if (create) {
    await chmod(directory, SESSION_DIRECTORY_MODE);
  }
}

async function inspectSessionFile(
  paths: AppPaths,
  allowPermissionRepair = false
): Promise<Awaited<ReturnType<typeof lstat>> | undefined> {
  const stats = await lstat(paths.sessionFile).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  if (!stats) {
    return undefined;
  }
  await validateSessionDirectory(path.dirname(paths.sessionFile), false);
  const currentUid = process.getuid?.();
  if (
    !stats.isFile() ||
    stats.isSymbolicLink() ||
    stats.size === 0 ||
    stats.size > MAX_SESSION_BYTES ||
    (!allowPermissionRepair && (stats.mode & 0o077) !== 0) ||
    (currentUid !== undefined && stats.uid !== currentUid)
  ) {
    throw new UserFacingError(
      'Ubisoft session file must be a nonempty owner-only regular file.'
    );
  }
  return stats;
}

export async function sessionExists(paths: AppPaths): Promise<boolean> {
  return Boolean(await inspectSessionFile(paths));
}

export async function loadSession(
  paths: AppPaths
): Promise<StoredSession | null> {
  if (!(await inspectSessionFile(paths, true))) {
    return null;
  }

  let handle;
  try {
    handle = await open(
      paths.sessionFile,
      constants.O_RDONLY | constants.O_NOFOLLOW
    );
    const stats = await handle.stat();
    const currentUid = process.getuid?.();
    if (
      !stats.isFile() ||
      stats.size === 0 ||
      stats.size > MAX_SESSION_BYTES ||
      (currentUid !== undefined && stats.uid !== currentUid)
    ) {
      throw new UserFacingError('Ubisoft session file changed during load.');
    }
    await handle.chmod(SESSION_FILE_MODE);
    return validateSession(JSON.parse(await handle.readFile('utf8')));
  } catch (error) {
    if (error instanceof UserFacingError) {
      throw error;
    }
    throw new UserFacingError(
      `Could not safely load the Ubisoft session: ${error instanceof Error ? error.message : String(error)}`
    );
  } finally {
    await handle?.close();
  }
}

export async function saveSession(
  paths: AppPaths,
  session: StoredSession
): Promise<void> {
  const validated = validateSession(session);
  const directory = path.dirname(paths.sessionFile);
  await validateSessionDirectory(directory, true);
  const existing = await lstat(paths.sessionFile).catch((error: unknown) => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return undefined;
    }
    throw error;
  });
  const currentUid = process.getuid?.();
  if (
    existing &&
    (!existing.isFile() ||
      existing.isSymbolicLink() ||
      (currentUid !== undefined && existing.uid !== currentUid))
  ) {
    throw new UserFacingError(
      'Refusing to replace an unsafe Ubisoft session file.'
    );
  }

  const temporaryPath = `${paths.sessionFile}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', SESSION_FILE_MODE);
  try {
    await handle.writeFile(JSON.stringify(validated, null, 2));
    await handle.sync();
  } catch (error) {
    await rm(temporaryPath, { force: true });
    throw error;
  } finally {
    await handle.close();
  }

  await rename(temporaryPath, paths.sessionFile);
  await chmod(paths.sessionFile, SESSION_FILE_MODE);
}

export async function clearSession(paths: AppPaths): Promise<void> {
  await rm(paths.sessionFile, { force: true });
}

export async function withSessionLock<T>(
  paths: AppPaths,
  operation: () => Promise<T>
): Promise<T> {
  const directory = path.dirname(paths.sessionFile);
  await validateSessionDirectory(directory, true);
  const lockPath = `${paths.sessionFile}.lock`;
  let lockHandle;
  try {
    lockHandle = await open(lockPath, 'wx', 0o600);
    await lockHandle.writeFile(`${process.pid}\n`);
  } catch (error) {
    if (lockHandle) {
      await lockHandle.close().catch(() => undefined);
      await rm(lockPath, { force: true });
    }
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') {
      throw new UserFacingError(
        `Another process is updating the Ubisoft session. If it crashed, verify no ubi process remains before removing ${lockPath}.`
      );
    }
    throw error;
  }

  try {
    return await operation();
  } finally {
    try {
      await lockHandle.close();
    } finally {
      await rm(lockPath, { force: true });
    }
  }
}

export function redactSession(
  session: StoredSession | null
): Record<string, unknown> | null {
  if (!session) {
    return null;
  }

  return {
    ...session,
    ticket: session.ticket ? '<redacted>' : undefined,
    sessionId: session.sessionId ? '<redacted>' : undefined,
    rememberMeTicket: session.rememberMeTicket ? '<redacted>' : undefined
  };
}
