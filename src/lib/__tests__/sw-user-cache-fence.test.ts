import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CacheFirst, CacheableResponsePlugin, NetworkFirst, StaleWhileRevalidate, type Strategy } from 'serwist';
import { createUserCacheFence } from '@/lib/sw-user-cache-fence';

// Cache Storage as the worker sees it, in memory. As in a browser, opening a
// deleted cache creates a new one. `openGate` holds one open, to land a clear
// between a write's check and the cache it writes to.
class MemoryCache {
  entries = new Map<string, Response>();
  async match(request: RequestInfo) {
    return this.entries.get(typeof request === 'string' ? request : request.url)?.clone();
  }
  async put(request: RequestInfo, response: Response) {
    this.entries.set(typeof request === 'string' ? request : request.url, response);
  }
  async delete(request: RequestInfo) {
    return this.entries.delete(typeof request === 'string' ? request : request.url);
  }
  async keys() {
    return [...this.entries.keys()].map((url) => new Request(url));
  }
}
class MemoryCacheStorage {
  stores = new Map<string, MemoryCache>();
  openGate: { name: string; wait: Promise<void> } | null = null;
  openWaiting = false;
  async open(name: string) {
    if (this.openGate?.name === name) {
      const { wait } = this.openGate;
      this.openGate = null;
      this.openWaiting = true;
      await wait;
    }
    if (!this.stores.has(name)) this.stores.set(name, new MemoryCache());
    return this.stores.get(name)!;
  }
  async delete(name: string) {
    return this.stores.delete(name);
  }
  async has(name: string) {
    return this.stores.has(name);
  }
  async match(request: RequestInfo, options?: { cacheName?: string }) {
    const names = options?.cacheName ? [options.cacheName] : [...this.stores.keys()];
    for (const name of names) {
      const hit = await this.stores.get(name)?.match(request);
      if (hit) return hit;
    }
    return undefined;
  }
}

// The worker's events, as far as Serwist uses them.
class WorkerEvent {
  pending: Promise<unknown>[] = [];
  waitUntil(promise: Promise<unknown>) {
    this.pending.push(promise);
  }
}

let storage: MemoryCacheStorage;
let release: (response: Response) => void;

beforeEach(() => {
  // As the worker ships: Serwist's development logging needs a worker console.
  vi.stubEnv('NODE_ENV', 'production');
  storage = new MemoryCacheStorage();
  vi.stubGlobal('caches', storage);
  vi.stubGlobal('self', globalThis);
  // Serwist tells a FetchEvent from its options object; there is none outside a worker.
  vi.stubGlobal('FetchEvent', class {});
  vi.stubGlobal('ExtendableEvent', WorkerEvent);
  // Every fetch waits until the test releases it.
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((resolve) => { release = resolve; })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

async function run(strategy: Strategy, url: string, during: () => Promise<void>) {
  const event = new WorkerEvent();
  const handled = strategy.handle({ request: new Request(url), event: event as never });
  await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
  await during();
  release(new Response('bytes', { status: 200 }));
  const response = await handled;
  await Promise.all(event.pending);
  return response;
}

const signOut = (fence: ReturnType<typeof createUserCacheFence>, name: string) => async () => {
  fence.advance();
  await storage.delete(name);
};

describe('user-scoped cache fence', () => {
  it('writes a response when no clear happened meanwhile', async () => {
    const fence = createUserCacheFence();
    await run(new CacheFirst({ cacheName: 'api-images', plugins: [fence.plugin] }), 'https://helprr.test/api/image?u=1', async () => {});
    expect((await storage.open('api-images')).entries.size).toBe(1);
  });

  it('does not refill a cache cleared while the request was in flight', async () => {
    const fence = createUserCacheFence();
    const response = await run(
      new CacheFirst({ cacheName: 'api-images', plugins: [fence.plugin] }),
      'https://helprr.test/api/image?u=1',
      signOut(fence, 'api-images'),
    );
    // The page that asked still gets its response; it is only not kept.
    expect(response.status).toBe(200);
    expect(await storage.has('api-images')).toBe(false);
  });

  it('takes the entry back out when the clear lands between the check and the write', async () => {
    const fence = createUserCacheFence();
    let openGate!: () => void;
    storage.openGate = { name: 'api-readonly', wait: new Promise((resolve) => { openGate = resolve; }) };
    const strategy = new NetworkFirst({ cacheName: 'api-readonly', plugins: [fence.plugin] });
    const event = new WorkerEvent();
    const handled = strategy.handle({ request: new Request('https://helprr.test/api/sonarr'), event: event as never });
    await vi.waitFor(() => expect(fetch).toHaveBeenCalled());
    release(new Response('[]', { status: 200 }));
    await handled;
    // The write has passed its check and is opening its cache: sign out now.
    await vi.waitFor(() => expect(storage.openWaiting).toBe(true));
    fence.advance();
    await storage.delete('api-readonly');
    openGate();
    await Promise.all(event.pending);
    // Opening recreated the cache and the write landed in it; then its own entry came back out.
    expect((await storage.open('api-readonly')).entries.size).toBe(0);
  });

  it("keeps a page shell's background refresh out of a cleared cache", async () => {
    const fence = createUserCacheFence();
    const pages = await storage.open('pages');
    pages.entries.set('https://helprr.test/movies', new Response('old shell'));
    const response = await run(
      new StaleWhileRevalidate({ cacheName: 'pages', plugins: [fence.plugin] }),
      'https://helprr.test/movies',
      signOut(fence, 'pages'),
    );
    expect(await response.text()).toBe('old shell');
    expect(await storage.has('pages')).toBe(false);
  });

  it("holds with the pages cache's other plugins after it", async () => {
    const fence = createUserCacheFence();
    const strategy = () => new StaleWhileRevalidate({ cacheName: 'pages', plugins: [fence.plugin, new CacheableResponsePlugin({ statuses: [200] })] });
    await run(strategy(), 'https://helprr.test/series', async () => {});
    expect((await storage.open('pages')).entries.size).toBe(1);
    await run(strategy(), 'https://helprr.test/movies', signOut(fence, 'pages'));
    expect(await storage.has('pages')).toBe(false);
  });

  it('writes again for requests that start after the clear', async () => {
    const fence = createUserCacheFence();
    fence.advance();
    await run(new CacheFirst({ cacheName: 'api-images', plugins: [fence.plugin] }), 'https://helprr.test/api/image?u=2', async () => {});
    expect((await storage.open('api-images')).entries.size).toBe(1);
  });
});
