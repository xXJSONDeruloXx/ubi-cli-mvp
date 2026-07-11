import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConfig } from '../models/config';
import type { Logger } from '../util/logger';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retryCount?: number;
  signal?: AbortSignal;
}

export interface RawResponse {
  status: number;
  headers: Headers;
  body: Uint8Array;
  text: string;
}

export interface JsonResponse<T> {
  status: number;
  headers: Headers;
  data: T;
  rawText: string;
}

function retryDelayMs(response: Response, attempt: number): number {
  const retryAfter = response.headers.get('retry-after');
  if (retryAfter && /^\d+$/.test(retryAfter.trim())) {
    return Math.min(Number.parseInt(retryAfter, 10) * 1000, 60_000);
  }

  // Decorrelated enough for this small CLI while still deterministic in tests.
  return Math.min(
    200 * 2 ** (attempt - 1) + Math.floor(Math.random() * 100),
    5_000
  );
}

function redactUrlForLog(value: string): string {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search ? '?<redacted>' : ''}`;
  } catch {
    return '<invalid-url>';
  }
}

export class HttpClient {
  public constructor(
    private readonly config: RuntimeConfig,
    private readonly logger: Logger,
    private readonly fetchImpl: typeof fetch = globalThis.fetch
  ) {}

  public async requestRaw(
    url: string,
    options: RequestOptions = {}
  ): Promise<RawResponse> {
    const retries = options.retryCount ?? this.config.httpRetryCount;
    const timeoutMs = options.timeoutMs ?? this.config.httpTimeoutMs;
    let attempt = 0;

    while (true) {
      attempt += 1;
      if (options.signal?.aborted) {
        throw (
          options.signal.reason ?? new DOMException('Aborted', 'AbortError')
        );
      }

      const timeoutController = new AbortController();
      const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
      const signal = options.signal
        ? AbortSignal.any([options.signal, timeoutController.signal])
        : timeoutController.signal;

      try {
        const response = await this.fetchImpl(url, {
          method: options.method ?? 'GET',
          headers: options.headers,
          body:
            options.body === undefined
              ? undefined
              : typeof options.body === 'string'
                ? options.body
                : JSON.stringify(options.body),
          signal
        });

        const body = new Uint8Array(await response.arrayBuffer());
        const text = new TextDecoder().decode(body);

        if (
          (response.status === 429 || response.status >= 500) &&
          attempt <= retries
        ) {
          await delay(retryDelayMs(response, attempt), undefined, {
            signal: options.signal
          });
          continue;
        }

        return {
          status: response.status,
          headers: response.headers,
          body,
          text
        };
      } catch (error) {
        const isAbort =
          options.signal?.aborted ||
          (error instanceof DOMException && error.name === 'AbortError');
        this.logger.debug('http request failed', {
          url: redactUrlForLog(url),
          attempt,
          isAbort,
          error: error instanceof Error ? error.message : String(error)
        });

        if (isAbort || attempt > retries) {
          throw error;
        }

        await delay(Math.min(200 * 2 ** (attempt - 1), 5_000), undefined, {
          signal: options.signal
        });
      } finally {
        clearTimeout(timeout);
      }
    }
  }

  public async requestJson<T>(
    url: string,
    options: RequestOptions = {}
  ): Promise<JsonResponse<T>> {
    const response = await this.requestRaw(url, options);
    const data =
      response.text.length > 0 ? (JSON.parse(response.text) as T) : ({} as T);

    return {
      status: response.status,
      headers: response.headers,
      data,
      rawText: response.text
    };
  }
}
