import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  clearSession,
  loadSession,
  redactSession,
  saveSession
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
    await expect(loadSession(paths)).resolves.toEqual(session);
    expect(redactSession(session)).toMatchObject({
      ticket: '<redacted>',
      sessionId: '<redacted>',
      rememberMeTicket: '<redacted>',
      userId: 'user-value'
    });

    await clearSession(paths);
    await expect(loadSession(paths)).resolves.toBeNull();
  });
});
