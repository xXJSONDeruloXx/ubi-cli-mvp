import { Buffer } from 'node:buffer';
import {
  clearSession,
  loadSession,
  saveSession,
  type StoredSession
} from './session-store';
import type { AppPaths, RuntimeConfig } from '../models/config';
import type { AccountIdentity } from '../models/account';
import type { Logger } from '../util/logger';
import { HttpClient } from './http';
import { UserFacingError } from '../util/errors';

interface SessionApiResponse {
  platformType?: string | null;
  ticket?: string | null;
  twoFactorAuthenticationTicket?: string | null;
  profileId?: string | null;
  userId?: string | null;
  nameOnPlatform?: string | null;
  expiration?: string | null;
  serverTime?: string | null;
  sessionId?: string | null;
  rememberMeTicket?: string | null;
  email?: string | null;
  message?: string;
  codeGenerationPreference?: string[];
}

interface UserApiResponse {
  userId?: string;
  username?: string;
  nameOnPlatform?: string;
  country?: string;
  dateOfBirth?: string;
  email?: string;
}

export interface TwoFactorRequiredResult {
  kind: '2fa-required';
  ticket: string;
  methods: string[];
}

export interface LoginSuccessResult {
  kind: 'success';
  session: StoredSession;
}

export type LoginResult = TwoFactorRequiredResult | LoginSuccessResult;

const SERVICES_BASE_URL = 'https://public-ubiservices.ubi.com';
const CHROME_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

export class AuthService {
  public constructor(
    private readonly paths: AppPaths,
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly httpClient: HttpClient = new HttpClient(
      config,
      logger.child('http')
    )
  ) {}

  public async loginWithPassword(
    email: string,
    password: string
  ): Promise<LoginResult> {
    const credentials = Buffer.from(`${email}:${password}`).toString('base64');
    const initialHeaders = {
      ...this.getCommonHeaders(),
      Authorization: `Basic ${credentials}`
    };

    const initialResponse =
      await this.httpClient.requestJson<SessionApiResponse>(
        `${SERVICES_BASE_URL}/v3/profiles/sessions`,
        {
          method: 'POST',
          headers: initialHeaders,
          body: { rememberMe: true }
        }
      );

    let response = initialResponse;
    const challenge = initialResponse.headers.get('Ubi-Challenge');

    if (
      challenge &&
      !initialResponse.data.ticket &&
      !initialResponse.data.twoFactorAuthenticationTicket
    ) {
      response = await this.httpClient.requestJson<SessionApiResponse>(
        `${SERVICES_BASE_URL}/v3/profiles/sessions`,
        {
          method: 'POST',
          headers: {
            ...initialHeaders,
            'Ubi-Challenge': challenge
          },
          body: { rememberMe: true }
        }
      );
    }

    return this.handleLoginResponse(response, email);
  }

  public async completeTwoFactor(
    twoFactorTicket: string,
    code: string,
    email?: string
  ): Promise<LoginSuccessResult> {
    const response = await this.httpClient.requestJson<SessionApiResponse>(
      `${SERVICES_BASE_URL}/v3/profiles/sessions`,
      {
        method: 'POST',
        headers: {
          ...this.getCommonHeaders(),
          Authorization: `ubi_2fa_v1 t=${twoFactorTicket}`,
          'Ubi-2faCode': code
        },
        body: { rememberMe: true }
      }
    );

    const result = await this.handleLoginResponse(response, email);
    if (result.kind !== 'success') {
      throw new UserFacingError(
        'Ubisoft returned another 2FA challenge instead of a session.'
      );
    }

    return result;
  }

  public async logout(): Promise<void> {
    await clearSession(this.paths);
  }

  public async getStoredSession(): Promise<StoredSession | null> {
    return loadSession(this.paths);
  }

  public async ensureValidSession(): Promise<StoredSession> {
    const session = await loadSession(this.paths);
    if (!session) {
      throw new UserFacingError(
        'No Ubisoft session found. Run `ubi login` first.'
      );
    }

    if (!this.shouldRefresh(session)) {
      return session;
    }

    this.logger.info('refreshing ubisoft session');
    const refreshed = await this.refreshSession(session);
    await saveSession(this.paths, refreshed);
    return refreshed;
  }

  public async getIdentity(): Promise<AccountIdentity> {
    const session = await this.ensureValidSession();
    const response = await this.httpClient.requestJson<UserApiResponse>(
      `${SERVICES_BASE_URL}/v3/users/${session.userId}`,
      {
        method: 'GET',
        headers: this.getAuthenticatedHeaders(session)
      }
    );

    if (
      response.status >= 200 &&
      response.status < 300 &&
      response.data.userId
    ) {
      return {
        userId: response.data.userId,
        username:
          response.data.username ?? session.nameOnPlatform ?? session.userId,
        nameOnPlatform:
          response.data.nameOnPlatform ??
          session.nameOnPlatform ??
          response.data.username ??
          session.userId,
        email: response.data.email ?? session.email,
        country: response.data.country,
        dateOfBirth: response.data.dateOfBirth,
        source: 'live'
      };
    }

    return {
      userId: session.userId,
      username: session.nameOnPlatform ?? session.userId,
      nameOnPlatform: session.nameOnPlatform ?? session.userId,
      email: session.email,
      source: 'session'
    };
  }

  public async refreshSession(session: StoredSession): Promise<StoredSession> {
    const ticketResponse =
      await this.httpClient.requestJson<SessionApiResponse>(
        `${SERVICES_BASE_URL}/v3/profiles/sessions`,
        {
          method: 'PUT',
          headers: {
            ...this.getAuthenticatedHeaders(session),
            Authorization: `Ubi_v1 t=${session.ticket}`
          }
        }
      );

    if (
      ticketResponse.status >= 200 &&
      ticketResponse.status < 300 &&
      ticketResponse.data.ticket
    ) {
      return this.toStoredSession(
        ticketResponse.data,
        session.email ?? undefined
      );
    }

    if (!session.rememberMeTicket) {
      throw new UserFacingError(
        'Ubisoft session expired and no remember-me ticket is available.'
      );
    }

    const rememberResponse =
      await this.httpClient.requestJson<SessionApiResponse>(
        `${SERVICES_BASE_URL}/v3/profiles/sessions`,
        {
          method: 'POST',
          headers: {
            ...this.getCommonHeaders(),
            Authorization: `rm_v1 t=${session.rememberMeTicket}`
          },
          body: { rememberMe: true }
        }
      );

    if (
      !(
        rememberResponse.status >= 200 &&
        rememberResponse.status < 300 &&
        rememberResponse.data.ticket
      )
    ) {
      throw new UserFacingError(
        'Ubisoft session refresh failed. Run `ubi login` again.'
      );
    }

    return this.toStoredSession(
      rememberResponse.data,
      session.email ?? undefined
    );
  }

  private async handleLoginResponse(
    response: { status: number; data: SessionApiResponse },
    email?: string
  ): Promise<LoginResult> {
    if (response.data.twoFactorAuthenticationTicket) {
      return {
        kind: '2fa-required',
        ticket: response.data.twoFactorAuthenticationTicket,
        methods: response.data.codeGenerationPreference ?? []
      };
    }

    if (
      !(response.status >= 200 && response.status < 300 && response.data.ticket)
    ) {
      throw new UserFacingError(
        response.data.message ??
          `Ubisoft login failed with HTTP ${response.status}.`
      );
    }

    const session = this.toStoredSession(response.data, email);
    await saveSession(this.paths, session);
    return { kind: 'success', session };
  }

  private toStoredSession(
    data: SessionApiResponse,
    email?: string
  ): StoredSession {
    if (!data.ticket || !data.sessionId || !data.userId) {
      throw new UserFacingError(
        'Ubisoft returned an incomplete session payload.'
      );
    }

    return {
      ticket: data.ticket,
      sessionId: data.sessionId,
      userId: data.userId,
      profileId: data.profileId ?? undefined,
      nameOnPlatform: data.nameOnPlatform ?? undefined,
      email: data.email ?? email,
      expiration: data.expiration ?? undefined,
      rememberMeTicket: data.rememberMeTicket ?? undefined,
      refreshTime: this.computeRefreshTime(
        data.expiration ?? undefined,
        data.serverTime ?? undefined
      )
    };
  }

  private computeRefreshTime(
    expiration?: string,
    serverTime?: string
  ): number | undefined {
    if (!expiration || !serverTime) {
      return undefined;
    }

    const expirationMs = Date.parse(expiration);
    const serverMs = Date.parse(serverTime);

    if (Number.isNaN(expirationMs) || Number.isNaN(serverMs)) {
      return undefined;
    }

    const remainingMs = expirationMs - serverMs;
    return Math.floor(Date.now() + remainingMs * 0.8);
  }

  private shouldRefresh(session: StoredSession): boolean {
    if (session.refreshTime) {
      return Date.now() >= session.refreshTime;
    }

    if (!session.expiration) {
      return false;
    }

    return Date.now() >= Date.parse(session.expiration) - 300_000;
  }

  private getCommonHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Ubi-AppId': this.config.servicesAppId,
      'Ubi-RequestedPlatformType': this.config.requestedPlatformType,
      'User-Agent': CHROME_USER_AGENT
    };
  }

  private getAuthenticatedHeaders(
    session: StoredSession
  ): Record<string, string> {
    return {
      ...this.getCommonHeaders(),
      Authorization: `Ubi_v1 t=${session.ticket}`,
      'Ubi-SessionId': session.sessionId
    };
  }
}
