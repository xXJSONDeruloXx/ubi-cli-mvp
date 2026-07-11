import { randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  access,
  chmod,
  mkdir,
  open,
  readFile,
  rename,
  rm
} from 'node:fs/promises';
import path from 'node:path';
import type { AppPaths } from '../models/config';

const SESSION_FILE_MODE = 0o600;

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

export async function sessionExists(paths: AppPaths): Promise<boolean> {
  try {
    await access(paths.sessionFile, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

export async function loadSession(
  paths: AppPaths
): Promise<StoredSession | null> {
  if (!(await sessionExists(paths))) {
    return null;
  }

  await chmod(paths.sessionFile, SESSION_FILE_MODE);
  const raw = await readFile(paths.sessionFile, 'utf8');
  return JSON.parse(raw) as StoredSession;
}

export async function saveSession(
  paths: AppPaths,
  session: StoredSession
): Promise<void> {
  await mkdir(path.dirname(paths.sessionFile), { recursive: true });
  const temporaryPath = `${paths.sessionFile}.${randomUUID()}.tmp`;
  const handle = await open(temporaryPath, 'wx', SESSION_FILE_MODE);

  try {
    await handle.writeFile(JSON.stringify(session, null, 2));
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
