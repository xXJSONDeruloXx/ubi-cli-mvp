import { setTimeout as delay } from 'node:timers/promises';
import type { RuntimeConfig } from '../models/config';
import type { Logger } from '../util/logger';

export interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE' | 'HEAD';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  retryCount?: number;
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
      const abortController = new AbortController();
      const timeout = setTimeout(() => abortController.abort(), timeoutMs);

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
          signal: abortController.signal
        });

        const body = new Uint8Array(await response.arrayBuffer());
        const text = new TextDecoder().decode(body);

        if (
          (response.status === 429 || response.status >= 500) &&
          attempt <= retries + 1
        ) {
          await delay(200 * attempt);
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
          error instanceof DOMException && error.name === 'AbortError';
        this.logger.debug('http request failed', {
          url,
          attempt,
          isAbort,
          error: error instanceof Error ? error.message : String(error)
        });

        if (attempt > retries + 1) {
          throw error;
        }

        await delay(200 * attempt);
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
