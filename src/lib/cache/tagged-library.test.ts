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
    })).resolves.toEqual({ items: cached, cached: true, available: true });

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
    });

    expect(mocks.setCachedJson).not.toHaveBeenCalled();
  });
});
