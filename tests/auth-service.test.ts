import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { AuthService } from '../src/core/auth-service';
import { DEFAULT_CONFIG } from '../src/core/config';
import { HttpClient } from '../src/core/http';
import {
  loadSession,
  saveSession,
  type StoredSession
} from '../src/core/session-store';
import type { AppPaths } from '../src/models/config';
import { createLogger } from '../src/util/logger';

async function makePaths(): Promise<AppPaths> {
  const root = await mkdtemp(path.join(tmpdir(), 'ubi-cli-auth-'));

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

function makeService(fetchImpl: typeof fetch, paths: AppPaths): AuthService {
  const logger = createLogger('silent');
  const httpClient = new HttpClient(DEFAULT_CONFIG, logger, fetchImpl);
  return new AuthService(paths, DEFAULT_CONFIG, logger, httpClient);
}

function jsonResponse(
  body: unknown,
  status = 200,
  headers?: Record<string, string>
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...(headers ?? {})
    }
  });
}

describe('auth-service', () => {
  it('retries login with Ubi-Challenge and persists the resulting session', async () => {
    const paths = await makePaths();
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({}, 200, { 'Ubi-Challenge': 'nonce-value' })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ticket: 'ticket-value',
          sessionId: 'session-value',
          userId: 'user-value',
          nameOnPlatform: 'Tester',
          rememberMeTicket: 'remember-value',
          expiration: '2026-03-23T12:00:00.000Z',
          serverTime: '2026-03-23T11:00:00.000Z'
        })
      );

    const auth = makeService(fetchMock, paths);
    const result = await auth.loginWithPassword('user@example.com', 'password');

    expect(result.kind).toBe('success');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[1]?.headers).toMatchObject({
      'Ubi-Challenge': 'nonce-value'
    });
    await expect(loadSession(paths)).resolves.toMatchObject({
      ticket: 'ticket-value',
      sessionId: 'session-value',
      userId: 'user-value',
      rememberMeTicket: 'remember-value'
    });
  });

  it('returns a 2FA challenge result when Ubisoft requests it', async () => {
    const paths = await makePaths();
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValueOnce(
      jsonResponse({
        twoFactorAuthenticationTicket: '2fa-ticket',
        codeGenerationPreference: ['email']
      })
    );

    const auth = makeService(fetchMock, paths);
    const result = await auth.loginWithPassword('user@example.com', 'password');

    expect(result).toEqual({
      kind: '2fa-required',
      ticket: '2fa-ticket',
      methods: ['email']
    });
  });

  it('refreshes with remember-me when ticket refresh fails', async () => {
    const paths = await makePaths();
    const expiredSession: StoredSession = {
      ticket: 'expired-ticket',
      sessionId: 'expired-session',
      userId: 'user-value',
      rememberMeTicket: 'remember-value',
      refreshTime: 1
    };

    await saveSession(paths, expiredSession);

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(jsonResponse({ message: 'expired' }, 401))
      .mockResolvedValueOnce(
        jsonResponse({
          ticket: 'fresh-ticket',
          sessionId: 'fresh-session',
          userId: 'user-value',
          rememberMeTicket: 'fresh-remember',
          expiration: '2026-03-23T13:00:00.000Z',
          serverTime: '2026-03-23T12:00:00.000Z'
        })
      );

    const auth = makeService(fetchMock, paths);
    const refreshed = await auth.ensureValidSession();

    expect(refreshed.ticket).toBe('fresh-ticket');
    expect(fetchMock).toHaveBeenCalledTimes(2);
    await expect(loadSession(paths)).resolves.toMatchObject({
      ticket: 'fresh-ticket',
      sessionId: 'fresh-session',
      rememberMeTicket: 'fresh-remember'
    });
  });
});
