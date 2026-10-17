import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readdir: vi.fn(),
  rm: vi.fn(),
  redis: {
    eval: vi.fn(),
    scan: vi.fn(),
    del: vi.fn(),
    set: vi.fn(),
    get: vi.fn(),
  },
}));

vi.mock('fs/promises', () => ({ readdir: mocks.readdir, rm: mocks.rm, stat: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedisClient: async () => mocks.redis }));
vi.mock('@/lib/cache/config', () => ({ IMAGE_CACHE_DIR: '/cache/images' }));
vi.mock('@/lib/cache/image-cache-health', () => ({ getImageCacheStorageHealth: vi.fn() }));
vi.mock('@/lib/cache/image-cache', () => ({ getImageProcessingSnapshot: vi.fn() }));
vi.mock('@/lib/cache/image-cache-accounting', () => ({
  getImageCacheDiagnostics: vi.fn(),
  unavailableImageCacheDiagnostics: vi.fn(),
}));

import { purgeOlderCacheGenerations } from '@/lib/cache/admin';

// Redis holding cache keys from generations 3, 4 and 5, plus keys that carry
// no generation and must survive.
const KEYS: Record<string, string[]> = {
  'helprr:cache:image:v*': ['helprr:cache:image:v4:aa', 'helprr:cache:image:v5:bb', 'helprr:cache:image:v6:cc'],
  'helprr:cache:image-index:v*': ['helprr:cache:image-index:v5', 'helprr:cache:image-index:v6'],
  'helprr:cache:image-lru:v*': ['helprr:cache:image-lru:v5'],
  'helprr:cache:image-usage:v*': ['helprr:cache:image-usage:v5'],
  'helprr:cache:tmdb:v*': ['helprr:cache:tmdb:v3:dd'],
  'helprr:cache:anilist:v*': [],
  'helprr:cache:api:*': ['helprr:cache:api:discover:v5:ee', 'helprr:cache:api:discover:v6:ff', 'helprr:cache:api:meta'],
};

// What the generation script does: max(stored, above) + 1, stored back.
let storedGeneration: number | null;
function generationScript(_script: string, { arguments: [above] }: { arguments: string[] }) {
  storedGeneration = Math.max(storedGeneration ?? 0, Number(above)) + 1;
  return Promise.resolve(storedGeneration);
}

beforeEach(() => {
  vi.resetAllMocks();
  storedGeneration = 5;
  mocks.redis.eval.mockImplementation(generationScript);
  mocks.redis.scan.mockImplementation(async (_cursor: string, { MATCH }: { MATCH: string }) => ({ cursor: '0', keys: KEYS[MATCH] ?? [] }));
  mocks.redis.del.mockResolvedValue(1);
  mocks.redis.set.mockResolvedValue('OK');
  // Generation 5 is current; v4 is a leftover.
  mocks.readdir.mockResolvedValue(['v4', 'v5', 'tmp', 'v5-old']);
  mocks.rm.mockResolvedValue(undefined);
});

describe('purgeOlderCacheGenerations', () => {
  it('starts a new generation and removes every older one, on disk and in Redis', async () => {
    await purgeOlderCacheGenerations();

    expect(mocks.redis.eval).toHaveBeenCalledWith(expect.any(String), { keys: ['helprr:cache:generation'], arguments: ['5'] });
    expect(storedGeneration).toBe(6);
    expect(mocks.rm.mock.calls.map(([dir]) => dir)).toEqual(['/cache/images/v4', '/cache/images/v5']);
    expect(mocks.redis.del.mock.calls.flatMap(([keys]) => keys).sort()).toEqual([
      'helprr:cache:api:discover:v5:ee',
      'helprr:cache:image-index:v5',
      'helprr:cache:image-lru:v5',
      'helprr:cache:image-usage:v5',
      'helprr:cache:image:v4:aa',
      'helprr:cache:image:v5:bb',
      'helprr:cache:tmdb:v3:dd',
    ]);
    expect(mocks.redis.set).toHaveBeenCalledWith('helprr:cache:lastPurgedAt', expect.any(String));
  });

  it('fails, and removes nothing, when the new generation cannot be started', async () => {
    mocks.redis.eval.mockRejectedValue(new Error('redis down'));

    await expect(purgeOlderCacheGenerations()).rejects.toThrow('redis down');
    expect(mocks.rm).not.toHaveBeenCalled();
    expect(mocks.redis.del).not.toHaveBeenCalled();
  });

  it('fails when cached files cannot be removed, and a later run removes them', async () => {
    mocks.rm.mockRejectedValueOnce(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(purgeOlderCacheGenerations()).rejects.toThrow('EACCES');

    // The next run starts generation 7 and still reaches the leftover v4 and v5.
    await expect(purgeOlderCacheGenerations()).resolves.toBeUndefined();
    expect(mocks.rm.mock.calls.slice(1).map(([dir]) => dir)).toEqual(['/cache/images/v4', '/cache/images/v5']);
  });

  it('fails when Redis keys cannot be scanned or deleted', async () => {
    mocks.redis.del.mockRejectedValueOnce(new Error('redis down'));
    await expect(purgeOlderCacheGenerations()).rejects.toThrow('redis down');

    mocks.redis.scan.mockRejectedValueOnce(new Error('redis down'));
    await expect(purgeOlderCacheGenerations()).rejects.toThrow('redis down');
  });

  it('starts above every generation still on disk when Redis lost its counter', async () => {
    storedGeneration = null;

    await purgeOlderCacheGenerations();

    expect(storedGeneration).toBe(6);
    expect(mocks.rm.mock.calls.map(([dir]) => dir)).toEqual(['/cache/images/v4', '/cache/images/v5']);
  });

  it('fails when the purge cannot be marked finished, since a stuck status stops cache maintenance', async () => {
    mocks.redis.set.mockImplementation(async (key: string, value: string) => {
      if (value === 'idle') throw new Error('redis down');
      return 'OK';
    });

    await expect(purgeOlderCacheGenerations()).rejects.toThrow('redis down');
  });

  it('treats a missing image cache directory as nothing to remove', async () => {
    mocks.readdir.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(purgeOlderCacheGenerations()).resolves.toBeUndefined();
    expect(mocks.rm).not.toHaveBeenCalled();
  });
});
