// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { isChunkLoadError, reloadForChunkLoadError } from '@/lib/chunk-load-recovery';

function chunkError(message = 'Loading chunk 123 failed.\n(error: /_next/static/chunks/123.js)') {
  const error = new Error(message);
  error.name = 'ChunkLoadError';
  return error;
}

describe('isChunkLoadError', () => {
  it.each([
    ['webpack ChunkLoadError by name', chunkError('anything')],
    ['webpack JS chunk message', new Error('Loading chunk 4821 failed.\n(missing: /_next/static/chunks/4821.js)')],
    ['named dev chunk message', new Error('Loading chunk app/(app)/page failed.\n(timeout: x)')],
    ['webpack CSS chunk message', new Error('Loading CSS chunk 9012 failed.\n(/_next/static/css/9012.css)')],
    ['Turbopack chunk message', new Error('Failed to load chunk /_next/static/chunks/abc.js from module 1')],
    ['Chrome dynamic import', new TypeError('Failed to fetch dynamically imported module: https://x/a.js')],
    ['Safari dynamic import', new TypeError('Importing a module script failed.')],
  ])('detects a %s', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(true);
  });

  it.each([
    ['an ordinary error', new Error('Cannot read properties of undefined')],
    ['a network error', new TypeError('Failed to fetch')],
    ['null', null],
    ['a string', 'ChunkLoadError'],
  ])('ignores %s', (_label, error) => {
    expect(isChunkLoadError(error)).toBe(false);
  });
});

describe('reloadForChunkLoadError', () => {
  const reload = vi.fn();
  const deleteCache = vi.fn();
  const fetchHealth = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-06T12:00:00Z'));
    sessionStorage.clear();
    reload.mockReset();
    deleteCache.mockReset().mockResolvedValue(true);
    vi.stubGlobal('location', { pathname: '/movies', reload });
    vi.stubGlobal('caches', { delete: deleteCache });
    fetchHealth.mockReset().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchHealth);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('clears the cached page shell, then reloads', async () => {
    expect(reloadForChunkLoadError(chunkError())).toBe(true);
    expect(deleteCache).toHaveBeenCalledWith('pages');
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('still reloads when clearing the cache fails', async () => {
    deleteCache.mockRejectedValue(new Error('SecurityError'));
    expect(reloadForChunkLoadError(chunkError())).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
  });

  it('reloads without the Cache API', async () => {
    vi.stubGlobal('caches', undefined);
    Reflect.deleteProperty(globalThis, 'caches');
    expect(reloadForChunkLoadError(chunkError())).toBe(true);
    expect(reload).toHaveBeenCalledOnce();
  });

  it('leaves other errors to the normal retry', () => {
    expect(reloadForChunkLoadError(new Error('boom'))).toBe(false);
    expect(reloadForChunkLoadError(new Error('boom'), { automatic: true })).toBe(false);
    expect(deleteCache).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('does not reload while offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    expect(reloadForChunkLoadError(chunkError())).toBe(false);
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('reloads automatically only once within the window, on any path', async () => {
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(true);
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(false);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledOnce());
    expect(fetchHealth).toHaveBeenCalledWith('/api/health', expect.objectContaining({ cache: 'no-store' }));

    vi.stubGlobal('location', { pathname: '/series', reload });
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(false);

    vi.advanceTimersByTime(30_000);
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(true);
    await vi.waitFor(() => expect(reload).toHaveBeenCalledTimes(2));
  });

  it('keeps the saved pages when the server does not answer', async () => {
    fetchHealth.mockRejectedValue(new TypeError('Failed to fetch'));
    reloadForChunkLoadError(chunkError(), { automatic: true });
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledOnce());
    await Promise.resolve();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();

    vi.advanceTimersByTime(30_000);
    fetchHealth.mockResolvedValue(new Response('', { status: 502 }));
    reloadForChunkLoadError(chunkError(), { automatic: true });
    await vi.waitFor(() => expect(fetchHealth).toHaveBeenCalledTimes(2));
    await Promise.resolve();
    expect(deleteCache).not.toHaveBeenCalled();
    expect(reload).not.toHaveBeenCalled();
  });

  it('lets a tap reload even after the automatic reload was used', () => {
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(true);
    expect(reloadForChunkLoadError(chunkError())).toBe(true);
  });

  it('skips the automatic reload when session storage is unavailable', () => {
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('QuotaExceededError');
    });
    expect(reloadForChunkLoadError(chunkError(), { automatic: true })).toBe(false);
    expect(deleteCache).not.toHaveBeenCalled();
    expect(reloadForChunkLoadError(chunkError())).toBe(true);
  });
});
