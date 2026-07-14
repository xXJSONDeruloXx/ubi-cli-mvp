import { mkdtemp, stat, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearSession,
  loadSession,
  redactSession,
  saveSession,
  sessionExists,
  withSessionLock
} from '../src/core/session-store';
import type { AppPaths } from '../src/models/config';

async function makePaths(): Promise<AppPaths> {
  const root = await mkdtemp(path.join(tmpdir(), 'ubi-cli-session-'));

  return {
    configDir: path.join(root, 'config'),
    cacheDir: path.join(root, 'cache'),
    dataDir: root,
    logDir: path.join(root, 'log'),
    debugDir: path.join(root, 'debug'),
    sessionFile: path.join(root, 'session.json'),
    configFile: path.join(root, 'config.json')
  };
}

describe('session-store', () => {
  it('saves, loads, redacts, and clears a session', async () => {
    const paths = await makePaths();
    const session = {
      ticket: 'ticket-value',
      sessionId: 'session-value',
      userId: 'user-value',
      rememberMeTicket: 'remember-value'
    };

    await saveSession(paths, session);
    expect((await stat(paths.sessionFile)).mode & 0o777).toBe(0o600);
    await expect(loadSession(paths)).resolves.toEqual(session);
    expect(redactSession(session)).toMatchObject({
      ticket: '<redacted>',
      sessionId: '<redacted>',
      rememberMeTicket: '<redacted>',
      userId: 'user-value'
    });

    const lockPath = `${paths.sessionFile}.lock`;
    await writeFile(lockPath, 'held', { mode: 0o600 });
    await expect(
      withSessionLock(paths, () => Promise.resolve())
    ).rejects.toThrow(/Another process/);

    await clearSession(paths);
    await expect(loadSession(paths)).resolves.toBeNull();
  });

  it('rejects symlinked and malformed session files without following them', async () => {
    const paths = await makePaths();
    const target = path.join(paths.dataDir, 'unrelated.json');
    await writeFile(
      target,
      JSON.stringify({ ticket: 't', sessionId: 's', userId: 'u' }),
      { mode: 0o600 }
    );
    await symlink(target, paths.sessionFile);

    await expect(sessionExists(paths)).rejects.toThrow(/regular file/);
    await expect(loadSession(paths)).rejects.toThrow(/regular file/);
    expect((await stat(target)).mode & 0o777).toBe(0o600);

    await clearSession(paths);
    await writeFile(paths.sessionFile, '{}', { mode: 0o600 });
    await expect(loadSession(paths)).rejects.toThrow(/required ticket/);
  });

  it('restricts permissions when loading a legacy session file', async () => {
    const paths = await makePaths();
    const session = {
      ticket: 'ticket-value',
      sessionId: 'session-value',
      userId: 'user-value'
    };

    await writeFile(paths.sessionFile, JSON.stringify(session), {
      mode: 0o644
    });
    await expect(loadSession(paths)).resolves.toEqual(session);
    expect((await stat(paths.sessionFile)).mode & 0o777).toBe(0o600);
  });
});
