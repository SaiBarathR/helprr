import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = vi.hoisted(() => new Map<string, number>());
vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => ({
    get: async (key: string) => (store.has(key) ? String(store.get(key)) : null),
    incr: async (key: string) => {
      store.set(key, (store.get(key) ?? 0) + 1);
      return store.get(key);
    },
  }),
}));

import { bumpQbitCacheVersion, getQbitCacheVersion } from './qbittorrent-version';

beforeEach(() => store.clear());

describe('the qBittorrent cache version (QBT-29)', () => {
  it('is one per instance: an action on one forces a fresh read of that one only', async () => {
    await bumpQbitCacheVersion('q1');
    await bumpQbitCacheVersion('q1');
    expect(await getQbitCacheVersion('q1')).toBe(2);
    expect(await getQbitCacheVersion('q2')).toBe(0);
    expect([...store.keys()]).toEqual(['helprr:cache:qbit:ver:q1']);
  });
});
