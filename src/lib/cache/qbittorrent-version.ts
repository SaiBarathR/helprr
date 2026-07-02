import { getRedisClient } from '@/lib/redis';

// Version stamp folded into the qbittorrent-summary cache seed. Bumped after
// any successful qBittorrent mutation so the client's fast reconcile refetch
// never reads a pre-action snapshot from the short summary cache.
const QBIT_CACHE_VERSION_KEY = 'helprr:cache:qbit:ver';

export async function getQbitCacheVersion(): Promise<number> {
  try {
    const redis = await getRedisClient();
    const value = await redis.get(QBIT_CACHE_VERSION_KEY);
    const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
    // Missing key defaults to 0, matching INCR's create-at-1 semantics: the
    // FIRST bump must change the seed (defaulting to 1 would make it a no-op).
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export async function bumpQbitCacheVersion(): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.incr(QBIT_CACHE_VERSION_KEY);
  } catch {
    // Best-effort: the 2s summary TTL is the backstop.
  }
}
