import { access, readFile, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import type { AppPaths } from '../models/config';

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

  const raw = await readFile(paths.sessionFile, 'utf8');
  return JSON.parse(raw) as StoredSession;
}

export async function saveSession(
  paths: AppPaths,
  session: StoredSession
): Promise<void> {
  await writeFile(paths.sessionFile, JSON.stringify(session, null, 2));
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
