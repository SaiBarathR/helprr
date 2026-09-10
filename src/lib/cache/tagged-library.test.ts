import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getCachedJson: vi.fn(),
  setCachedJson: vi.fn(),
  deleteCachedJson: vi.fn(),
  deleteCachedLibraryGaps: vi.fn(),
}));

vi.mock('@/lib/cache/json-cache', () => ({
  getCachedJson: mocks.getCachedJson,
  setCachedJson: mocks.setCachedJson,
  deleteCachedJson: mocks.deleteCachedJson,
}));
vi.mock('@/lib/cache/library-gaps-cache', () => ({
  deleteCachedLibraryGaps: mocks.deleteCachedLibraryGaps,
}));

vi.mock('@/lib/cache/state', () => ({ getCacheGeneration: async () => 1 }));

import { getCachedTaggedLibrary } from './tagged-library';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCachedJson.mockResolvedValue(null);
  mocks.setCachedJson.mockResolvedValue(undefined);
});

describe('getCachedTaggedLibrary', () => {
  it('performs no instance or upstream work on a warm cache hit', async () => {
    const cached = [{ id: 1, instanceId: 'r1', instanceLabel: 'Radarr' }];
    const getInstances = vi.fn();
    const fetchOne = vi.fn();
    mocks.getCachedJson.mockResolvedValue(cached);

    await expect(getCachedTaggedLibrary({
      scope: 'radarr',
      cacheKeySeed: 'all',
      getInstances,
      fetchOne,
    })).resolves.toEqual({ items: cached, cached: true, available: true, complete: true });

    expect(getInstances).not.toHaveBeenCalled();
    expect(fetchOne).not.toHaveBeenCalled();
  });

  it('returns a partial live result without caching it as complete', async () => {
    const getInstances = vi.fn().mockResolvedValue([
      { connection: { id: 'r1', label: 'Primary' }, client: { id: 'ok' } },
      { connection: { id: 'r2', label: 'Offline' }, client: { id: 'failed' } },
    ]);
    const fetchOne = vi.fn(async (client: { id: string }) => {
      if (client.id === 'failed') throw new Error('offline');
      return [{ id: 1 }];
    });

    await expect(getCachedTaggedLibrary({
      scope: 'radarr',
      cacheKeySeed: 'all',
      getInstances,
      fetchOne,
    })).resolves.toEqual({
      items: [{ id: 1, instanceId: 'r1', instanceLabel: 'Primary' }],
      cached: false,
      available: true,
      complete: false,
    });

    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });
});

describe('shared fills and invalidation', () => {
  it('deduplicates concurrent cold reads and prevents a mutation from reviving their result', async () => {
    const { invalidateTaggedLibrary } = await import('./tagged-library');
    let release!: (value: Array<{ id: number }>) => void;
    const getInstances = vi.fn(async () => [{ connection: { id: 'test-race', label: 'Test' }, client: {} }]);
    const fetchOne = vi.fn(() => new Promise<Array<{ id: number }>>((resolve) => { release = resolve; }));
    const opts = { scope: 'test-race', cacheKeySeed: 'all', getInstances, fetchOne };
    const first = getCachedTaggedLibrary(opts);
    const second = getCachedTaggedLibrary(opts);
    await vi.waitFor(() => expect(fetchOne).toHaveBeenCalledOnce());
    await invalidateTaggedLibrary('test-race');
    release([{ id: 1 }]);
    await Promise.all([first, second]);
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });
  it('serves a cached serialized response and ETag without deriving the collection again', async () => {
    const { getCachedTaggedLibraryJsonResponse } = await import('./tagged-library');
    const storage = new Map<string, unknown>();
    mocks.getCachedJson.mockImplementation(async (scope, seed) => storage.get(`${scope}:${seed}`) ?? null);
    mocks.setCachedJson.mockImplementation(async (scope, seed, value) => { storage.set(`${scope}:${seed}`, value); });
    const buildPayload = vi.fn(async () => ({ payload: [{ id: 1 }], itemCount: 1, cacheable: true }));
    const opts = { scope: 'projection-test', cacheKeySeed: 'all', projectionKey: 'list', buildPayload };
    const first = await getCachedTaggedLibraryJsonResponse({ headers: new Headers() }, {}, opts);
    const second = await getCachedTaggedLibraryJsonResponse({ headers: new Headers({ 'if-none-match': first.response.headers.get('etag')! }) }, {}, opts);
    expect(second.response.status).toBe(304);
    expect(buildPayload).toHaveBeenCalledOnce();
  });
  it('does not cache a partial projected library', async () => {
    const { getCachedTaggedLibraryJsonResponse } = await import('./tagged-library');
    await getCachedTaggedLibraryJsonResponse({ headers: new Headers() }, {}, { scope: 'partial-test', cacheKeySeed: 'all', projectionKey: 'list', buildPayload: async () => ({ payload: [], itemCount: 0, cacheable: false }) });
    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });
});
