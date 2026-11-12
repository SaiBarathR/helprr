import { afterEach, describe, expect, it, vi } from 'vitest';
import { CACHE_PAGE_MESSAGE_TYPE, isCacheablePagePath, MAX_PAGE_ASSETS, pageAssetPaths, pageWarmupRequest, warmPageCache } from './page-warmup';

const ORIGIN = 'https://helprr.example';

describe('pageWarmupRequest', () => {
  it('builds a same-origin document request that does not follow redirects', () => {
    const request = pageWarmupRequest('/calendar?view=week#today', ORIGIN);
    expect(request?.url).toBe(`${ORIGIN}/calendar?view=week`);
    expect(request?.method).toBe('GET');
    expect(request?.redirect).toBe('manual');
    expect(request?.credentials).toBe('same-origin');
    expect(request?.headers.get('RSC')).toBeNull();
  });

  it('accepts an absolute same-origin URL and the start URL', () => {
    expect(pageWarmupRequest(`${ORIGIN}/movies/12`, ORIGIN)?.url).toBe(`${ORIGIN}/movies/12`);
    expect(pageWarmupRequest('/', ORIGIN)?.url).toBe(`${ORIGIN}/`);
  });

  it('refuses other origins, API routes, the invite page and non-strings', () => {
    expect(pageWarmupRequest('https://elsewhere.example/dashboard', ORIGIN)).toBeNull();
    expect(pageWarmupRequest('//elsewhere.example/dashboard', ORIGIN)).toBeNull();
    expect(pageWarmupRequest('/api/calendar', ORIGIN)).toBeNull();
    expect(pageWarmupRequest('/invite?token=abc', ORIGIN)).toBeNull();
    expect(pageWarmupRequest(undefined, ORIGIN)).toBeNull();
    expect(pageWarmupRequest({ href: '/dashboard' }, ORIGIN)).toBeNull();
  });

  it('matches the paths the navigation route caches', () => {
    expect(isCacheablePagePath('/dashboard')).toBe(true);
    expect(isCacheablePagePath('/api/me')).toBe(false);
    expect(isCacheablePagePath('/invite')).toBe(false);
  });
});

describe('pageAssetPaths', () => {
  it('lists the scripts, styles and flight-data chunks a page loads, once each', () => {
    const html = [
      '<link rel="stylesheet" href="/_next/static/css/15730e9f7c5c55ef.css" data-precedence="next"/>',
      '<script src="/_next/static/chunks/webpack-0f1a.js" async=""></script>',
      '<script src="/_next/static/chunks/app/(app)/movies/%5Bid%5D/page-7fe9.js" async=""></script>',
      String.raw`<script>self.__next_f.push([1,"5:\"static/chunks/68771-32f5.js\"\n7:\"static/chunks/app/page-b445.js\"\n"])</script>`,
      '<script src="/_next/static/chunks/webpack-0f1a.js" async=""></script>',
      '<link rel="preload" href="/_next/static/media/22a5-s.p.woff2" as="font"/>',
      '<img src="/api/image?u=static/chunks/x.png">',
    ].join('');
    expect(pageAssetPaths(html, ORIGIN).sort()).toEqual([
      '/_next/static/chunks/68771-32f5.js',
      '/_next/static/chunks/app/(app)/movies/%5Bid%5D/page-7fe9.js',
      '/_next/static/chunks/app/page-b445.js',
      '/_next/static/chunks/webpack-0f1a.js',
      '/_next/static/css/15730e9f7c5c55ef.css',
    ]);
  });

  it('finds nothing in the offline page', () => {
    expect(pageAssetPaths('<!DOCTYPE html><html><body>You are offline</body></html>', ORIGIN)).toEqual([]);
  });

  // Server-rendered text from elsewhere (a TMDB overview) lands in the same
  // HTML, and the worker fetches each path with the user's cookies.
  it.each([
    ['dot segments out of /_next/static', 'static/chunks/../../../api/radarr/queue?x.js'],
    ['dot segments without a query', 'static/chunks/../../../api/sonarr/series.js'],
    ['encoded dot segments', 'static/chunks/%2e%2e/%2E%2E/%2e%2e/api/radarr/queue.js'],
    ['dot segments that stay inside', 'static/chunks/../chunks/x.js'],
    ['a query string', 'static/chunks/main.js?api=/api/radarr/queue&x.js'],
    ['a fragment', 'static/chunks/main#x.js'],
  ])('ignores a match with %s', (_label, path) => {
    const html = `<p>${JSON.stringify(path)}</p><script src="/_next/${path}"></script>`;
    expect(pageAssetPaths(html, ORIGIN)).toEqual([]);
  });

  it('reads a path inside another URL as this origin\'s own file', () => {
    expect(pageAssetPaths('<a href="https://evil.example/_next/static/chunks/x.js">', ORIGIN)).toEqual(['/_next/static/chunks/x.js']);
  });

  it(`keeps at most ${MAX_PAGE_ASSETS} assets from one page`, () => {
    const html = Array.from({ length: MAX_PAGE_ASSETS + 50 }, (_, i) => `<script src="/_next/static/chunks/${i}.js"></script>`).join('');
    const paths = pageAssetPaths(html, ORIGIN);
    expect(paths).toHaveLength(MAX_PAGE_ASSETS);
    expect(paths.every((path) => path.startsWith('/_next/static/chunks/'))).toBe(true);
  });
});

describe('warmPageCache', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function stubNavigator(onLine: boolean, controller: { postMessage: (message: unknown) => void } | null) {
    vi.stubGlobal('navigator', { onLine, serviceWorker: { controller } });
  }

  it('asks the controlling worker to cache the page', () => {
    const postMessage = vi.fn();
    stubNavigator(true, { postMessage });
    warmPageCache('/calendar');
    expect(postMessage).toHaveBeenCalledWith({ type: CACHE_PAGE_MESSAGE_TYPE, url: '/calendar' });
  });

  it('does nothing offline or without a controlling worker', () => {
    const postMessage = vi.fn();
    stubNavigator(false, { postMessage });
    warmPageCache('/calendar');
    expect(postMessage).not.toHaveBeenCalled();

    stubNavigator(true, null);
    expect(() => warmPageCache('/calendar')).not.toThrow();
  });

  it('swallows a failing postMessage', () => {
    stubNavigator(true, { postMessage: () => { throw new Error('gone'); } });
    expect(() => warmPageCache('/calendar')).not.toThrow();
  });
});
