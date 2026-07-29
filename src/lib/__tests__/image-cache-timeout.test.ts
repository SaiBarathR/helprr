import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/cache/state', () => ({
  getCacheGeneration: vi.fn(),
  getCacheImagesEnabled: vi.fn().mockResolvedValue(false),
  releaseCacheLock: vi.fn(),
  tryAcquireCacheLock: vi.fn(),
}));

import { fetchImageWithServerCache } from '@/lib/cache/image-cache';

describe('image cache upstream timeout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('uses a caller-provided timeout for an uncached upstream request', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn((_url: string, init: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener('abort', () => {
          reject(new DOMException('Aborted', 'AbortError'));
        });
      })));

    const resultPromise = fetchImageWithServerCache({
      cacheKey: 'lidarr:test',
      upstreamUrl: 'http://lidarr.internal/image.jpg',
      timeoutMs: 20_000,
    });

    await vi.advanceTimersByTimeAsync(19_999);
    let settled = false;
    void resultPromise.finally(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);

    await expect(resultPromise).resolves.toMatchObject({
      status: 504,
      body: null,
      cacheStatus: 'BYPASS',
    });
  });
});
