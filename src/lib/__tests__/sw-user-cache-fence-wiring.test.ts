import path from 'path';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// The worker itself (src/app/sw.ts), loaded with its Serwist options captured,
// its fence replaced by a recorder and `self` standing in for the worker scope.
const recorded = vi.hoisted(() => ({
  options: null as null | { runtimeCaching: Array<{ handler: { cacheName?: string; plugins?: unknown[] } }> },
  steps: [] as string[],
  listeners: new Map<string, (event: unknown) => void>(),
  plugin: { name: 'user-cache-fence' },
}));
vi.mock('@/lib/sw-user-cache-fence', () => ({
  createUserCacheFence: () => ({ plugin: recorded.plugin, advance: () => recorded.steps.push('advance') }),
}));
vi.mock('serwist', async (importOriginal) => ({
  ...(await importOriginal<typeof import('serwist')>()),
  Serwist: class {
    constructor(options: typeof recorded.options) {
      recorded.options = options;
    }
    addEventListeners() {}
  },
}));

beforeAll(async () => {
  vi.stubEnv('NODE_ENV', 'production');
  vi.stubGlobal('self', {
    __SW_MANIFEST: [],
    addEventListener: (type: string, listener: (event: unknown) => void) => recorded.listeners.set(type, listener),
    clients: { matchAll: async () => [] },
  });
  vi.stubGlobal('caches', { delete: async (name: string) => { recorded.steps.push(`delete ${name}`); return true; } });
  // sw.ts sits outside the app's TypeScript program (worker types); load it by path.
  await import(/* @vite-ignore */ path.resolve(__dirname, '../../app/sw.ts'));
});

beforeEach(() => {
  recorded.steps = [];
});

const strategyFor = (cacheName: string) =>
  recorded.options!.runtimeCaching.map((entry) => entry.handler).find((handler) => handler.cacheName === cacheName);

describe('the service worker wires the user-cache fence', () => {
  it.each(['pages', 'api-readonly', 'api-images'])('runs it first on the %s cache', (cacheName) => {
    expect(strategyFor(cacheName)?.plugins?.[0]).toBe(recorded.plugin);
  });

  it('moves it when a page asks, and answers', () => {
    const reply = vi.fn();
    recorded.listeners.get('message')!({ data: { type: 'helprr-fence-user-caches' }, ports: [{ postMessage: reply }] });
    expect(recorded.steps).toEqual(['advance']);
    expect(reply).toHaveBeenCalledWith({ ok: true });
  });

  it('moves it before its own clear deletes anything', async () => {
    const pending: Promise<unknown>[] = [];
    recorded.listeners.get('message')!({
      data: { type: 'helprr-clear-user-caches' },
      ports: [{ postMessage: () => {} }],
      waitUntil: (promise: Promise<unknown>) => pending.push(promise),
    });
    await Promise.all(pending);
    expect(recorded.steps).toEqual(['advance', 'delete pages', 'delete api-readonly', 'delete api-images']);
  });

  it('moves it before a live 401 drops the read-only cache', async () => {
    const browse = strategyFor('api-readonly')!.plugins!.find((plugin) => (plugin as { fetchDidSucceed?: unknown }).fetchDidSucceed) as {
      fetchDidSucceed: (param: { response: Response }) => Promise<Response>;
    };
    await browse.fetchDidSucceed({ response: new Response(null, { status: 401 }) });
    expect(recorded.steps).toEqual(['advance', 'delete api-readonly']);
    recorded.steps = [];
    await browse.fetchDidSucceed({ response: new Response('[]', { status: 200 }) });
    expect(recorded.steps).toEqual([]);
  });
});
