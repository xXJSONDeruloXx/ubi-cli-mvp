import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/core/config';
import { HttpClient } from '../src/core/http';
import { createLogger } from '../src/util/logger';

describe('http client', () => {
  it('retries a retryable response no more than the configured retry count', async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response('busy', { status: 503 }))
      .mockResolvedValueOnce(new Response('ok', { status: 200 }));
    const client = new HttpClient(
      { ...DEFAULT_CONFIG, httpRetryCount: 1 },
      createLogger('silent'),
      fetchMock
    );

    await expect(
      client.requestRaw('https://example.test/download')
    ).resolves.toMatchObject({
      status: 200,
      text: 'ok'
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not begin a request when the caller has already cancelled it', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchMock = vi.fn<typeof fetch>();
    const client = new HttpClient(
      DEFAULT_CONFIG,
      createLogger('silent'),
      fetchMock
    );

    await expect(
      client.requestRaw('https://example.test/download', {
        signal: controller.signal
      })
    ).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
