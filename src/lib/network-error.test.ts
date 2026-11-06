import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchOrOffline, isOfflineError, OfflineError } from './network-error';

describe('fetchOrOffline', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('marks a request that never reached the server, whatever the browser called it', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('FetchEvent.respondWith received an error: no-response')));
    const error = await fetchOrOffline('/api/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(OfflineError);
    expect((error as Error).message).toBe('FetchEvent.respondWith received an error: no-response');
  });

  it('passes an abort through unchanged', async () => {
    const controller = new AbortController();
    controller.abort();
    const abort = new DOMException('Aborted', 'AbortError');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(abort));
    await expect(fetchOrOffline('/api/x', { signal: controller.signal })).rejects.toBe(abort);
  });

  it('returns an HTTP error response for the caller to handle', async () => {
    const response = new Response(null, { status: 502 });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
    expect(await fetchOrOffline('/api/x')).toBe(response);
  });
});

describe('isOfflineError', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('treats only a marked network failure as offline while online', () => {
    vi.stubGlobal('navigator', { onLine: true });
    expect(isOfflineError(new OfflineError(new TypeError('Load failed')))).toBe(true);
    expect(isOfflineError(new Error('qBittorrent is not configured'))).toBe(false);
    expect(isOfflineError(new TypeError("Cannot read properties of undefined (reading 'hash')"))).toBe(false);
  });

  it('treats any failure as offline when the browser says it is offline', () => {
    vi.stubGlobal('navigator', { onLine: false });
    expect(isOfflineError(new Error('Failed to fetch'))).toBe(true);
  });
});
