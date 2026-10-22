import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Strategy } from 'serwist';

const recorded = vi.hoisted(() => ({
  options: null as null | {
    runtimeCaching: Array<{ handler: Strategy }>;
    fallbacks: { entries: Array<{ url: string; matcher: (param: { request: Request }) => boolean }> };
  },
}));

vi.mock('serwist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('serwist')>()),
  Serwist: class {
    constructor(options: typeof recorded.options) {
      recorded.options = options;
    }
    addEventListeners() {}
  },
  // Expiration's IndexedDB bookkeeping is unrelated to shell validation.
  ExpirationPlugin: class {},
}));

class NavigationEvent {
  pending: Promise<unknown>[] = [];
  preloadResponse = Promise.resolve<Response | undefined>(undefined);
  request = new Request('https://helprr.test/movies');
  constructor() {
    Object.defineProperty(this.request, 'mode', { value: 'navigate' });
  }
  waitUntil(promise: Promise<unknown>) {
    this.pending.push(promise);
  }
}

const shell = (headerNonce: string | null, bodyNonce: string | null) => new Response(
  `<html><script${bodyNonce === null ? '' : ` nonce="${bodyNonce}"`}>hydrate()</script></html>`,
  {
    headers: {
      'content-type': 'text/html',
      'x-helprr-shell-version': 'build-a',
      ...(headerNonce === null ? {} : { 'content-security-policy': `script-src 'nonce-${headerNonce}'` }),
    },
  },
);

const entries = new Map<string, Response>();
const cache = {
  match: async (request: Request) => entries.get(request.url)?.clone(),
  put: async (request: Request, response: Response) => { entries.set(request.url, response.clone()); },
  delete: vi.fn(async (request: Request) => entries.delete(request.url)),
};

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubEnv('NEXT_PUBLIC_SHELL_CACHE_VERSION', 'build-a');
  vi.stubGlobal('self', { __SW_MANIFEST: [], addEventListener: () => {} });
  // Like the existing worker wiring tests, keep worker types outside the app's TS program.
  await import(/* @vite-ignore */ path.resolve(__dirname, 'sw.ts'));
});

beforeEach(() => {
  entries.clear();
  cache.delete.mockClear();
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubGlobal('self', globalThis);
  vi.stubGlobal('FetchEvent', NavigationEvent);
  vi.stubGlobal('ExtendableEvent', NavigationEvent);
  vi.stubGlobal('caches', { open: async () => cache, match: cache.match });
  vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 503 })));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

const pages = () => recorded.options!.runtimeCaching.map((entry) => entry.handler)
  .find((handler) => handler.cacheName === 'pages')!;

describe('navigation shell nonce guard', () => {
  it('evicts a mismatched cached shell before falling back to the network', async () => {
    const event = new NavigationEvent();
    entries.set(event.request.url, shell('header', 'body'));
    let release!: (response: Response) => void;
    vi.mocked(fetch).mockImplementation(() => new Promise((resolve) => { release = resolve; }));

    const handled = pages().handle({ request: event.request, event: event as never });
    await vi.waitFor(() => expect(cache.delete).toHaveBeenCalledWith(event.request));
    expect(entries.has(event.request.url)).toBe(false);
    release(shell('fresh', 'fresh'));
    const response = await handled;
    expect(await response.text()).toContain('nonce="fresh"');
    await Promise.all(event.pending);
    expect(await entries.get(event.request.url)!.text()).toContain('nonce="fresh"');
  });

  it('evicts a mismatched shell offline and leaves the miss to the navigation fallback', async () => {
    const event = new NavigationEvent();
    entries.set(event.request.url, shell('header', 'body'));
    vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));

    await expect(pages().handle({ request: event.request, event: event as never })).rejects.toThrow('no-response');
    await Promise.all(event.pending);
    expect(cache.delete).toHaveBeenCalledWith(event.request);
    expect(entries.has(event.request.url)).toBe(false);
    const fallback = recorded.options!.fallbacks.entries[0];
    expect(fallback.url).toBe('/offline.html');
    expect(fallback.matcher({ request: event.request })).toBe(true);
  });

  it.each(['fetch', 'preload'])('does not cache a mismatched %s response or consume its body', async (source) => {
    const event = new NavigationEvent();
    const network = shell('header', 'body');
    if (source === 'preload') event.preloadResponse = Promise.resolve(network);
    else vi.mocked(fetch).mockResolvedValue(network);

    const response = await pages().handle({ request: event.request, event: event as never });
    await Promise.all(event.pending);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toContain('nonce="body"');
    expect(entries.has(event.request.url)).toBe(false);
    if (source === 'preload') expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    ['matching nonces', 'same', 'same'],
    ['no CSP', null, 'body'],
    ['no body nonce', 'header', null],
  ])('keeps a cached shell with %s', async (_label, headerNonce, bodyNonce) => {
    const event = new NavigationEvent();
    entries.set(event.request.url, shell(headerNonce, bodyNonce));
    const response = await pages().handle({ request: event.request, event: event as never });
    expect(await response.text()).toContain('hydrate()');
    await Promise.all(event.pending);
    expect(cache.delete).not.toHaveBeenCalled();
    expect(entries.has(event.request.url)).toBe(true);
  });

  it('writes a matching shell and preserves its version stamp and readable body', async () => {
    const event = new NavigationEvent();
    vi.mocked(fetch).mockResolvedValue(shell('same', 'same'));
    const response = await pages().handle({ request: event.request, event: event as never });
    await Promise.all(event.pending);
    expect(await response.text()).toContain('nonce="same"');
    const cached = entries.get(event.request.url)!;
    expect(cached.headers.get('x-helprr-shell-version')).toBe('build-a');
    expect(await cached.text()).toContain('nonce="same"');
  });

  it('does not read a body without a CSP nonce during cache validation', async () => {
    const event = new NavigationEvent();
    const response = shell(null, null);
    response.headers.set('content-security-policy', "script-src 'self'");
    entries.set(event.request.url, response);
    const read = vi.spyOn(Response.prototype, 'text');
    await pages().handle({ request: event.request, event: event as never });
    await Promise.all(event.pending);
    expect(read).not.toHaveBeenCalled();
  });
});
