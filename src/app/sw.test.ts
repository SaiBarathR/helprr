import path from 'path';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Strategy } from 'serwist';

const recorded = vi.hoisted(() => ({
  options: null as null | {
    navigationPreload: boolean;
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
    async matchPrecache(url: string) {
      return url === '/offline.html' ? new Response('Offline fallback') : undefined;
    }
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
  // sw.ts sits outside the app's TypeScript program (worker types); load it by path.
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

  it.each(['fetch', 'preload'])('retries a mismatched %s response without serving or caching it', async (source) => {
    const event = new NavigationEvent();
    const network = shell('header', 'body');
    if (source === 'preload') event.preloadResponse = Promise.resolve(network);
    else vi.mocked(fetch).mockResolvedValueOnce(network);
    vi.mocked(fetch).mockResolvedValue(shell('fresh', 'fresh'));

    const response = await pages().handle({ request: event.request, event: event as never });
    await Promise.all(event.pending);
    expect(response.bodyUsed).toBe(false);
    expect(await response.text()).toContain('nonce="fresh"');
    expect(entries.has(event.request.url)).toBe(false);
    expect(fetch).toHaveBeenCalledTimes(source === 'preload' ? 1 : 2);
    expect(fetch).toHaveBeenLastCalledWith(event.request);
  });

  it.each(['mismatch', 'offline'])('uses the offline shell if the one retry returns %s', async (failure) => {
    const event = new NavigationEvent();
    event.preloadResponse = Promise.resolve(shell('header', 'body'));
    if (failure === 'offline') vi.mocked(fetch).mockRejectedValue(new TypeError('offline'));
    else vi.mocked(fetch).mockResolvedValue(shell('again-header', 'again-body'));

    const response = await pages().handle({ request: event.request, event: event as never });
    expect(await response.text()).toBe('Offline fallback');
    await Promise.all(event.pending);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(entries.has(event.request.url)).toBe(false);
  });

  it.each(['cache', 'fetch', 'preload'])('responds to a %s shell before the HTML tail arrives', async (source) => {
    const event = new NavigationEvent();
    const encoder = new TextEncoder();
    let finish!: () => void;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('<html><script non'));
        controller.enqueue(encoder.encode('ce="sa'));
        controller.enqueue(encoder.encode('me">hydrate()</script>'));
        finish = () => {
          controller.enqueue(encoder.encode('<p>page data</p></html>'));
          controller.close();
        };
      },
    }), { headers: shell('same', 'same').headers });
    if (source === 'cache') entries.set(event.request.url, response);
    else if (source === 'preload') event.preloadResponse = Promise.resolve(response);
    else vi.mocked(fetch).mockResolvedValue(response);

    let ready = false;
    const handled = pages().handle({ request: event.request, event: event as never }).then((result) => {
      ready = true;
      return result;
    });
    try {
      await vi.waitFor(() => expect(ready).toBe(true), { timeout: 500 });
    } finally {
      finish();
      const result = await handled;
      expect(await result.text()).toContain('page data');
      await Promise.all(event.pending);
    }
  });

  it('finishes cache-write validation before the HTML tail arrives', async () => {
    const encoder = new TextEncoder();
    let finish!: () => void;
    const response = new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('<script nonce="same">'));
        finish = () => controller.close();
      },
    }), { headers: shell('same', 'same').headers });
    const plugin = pages().plugins.find((plugin) => plugin.cachedResponseWillBeUsed)!;
    let ready = false;
    const validated = Promise.resolve(plugin.cacheWillUpdate!({ response } as never)).then((result) => {
      ready = true;
      return result;
    });
    try {
      await vi.waitFor(() => expect(ready).toBe(true), { timeout: 500 });
    } finally {
      finish();
      const result = await validated;
      expect(result).toBeInstanceOf(Response);
    }
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

describe('worker updates', () => {
  it('does not use navigation preload, whose cancelled wait holds the old worker on WebKit', () => {
    expect(recorded.options!.navigationPreload).toBe(false);
  });
});
