import { getRedisClient } from '@/lib/redis';

// Version stamp folded into the qbittorrent-summary cache seed. Bumped after
// any successful qBittorrent mutation so the client's fast reconcile refetch
// never reads a pre-action snapshot from the short summary cache. One per
// qBittorrent instance (client.instanceId): an action on one doesn't force a
// read of the others. A client without an id (only in tests) uses the old key.
const QBIT_CACHE_VERSION_KEY = 'helprr:cache:qbit:ver';

function versionKey(instanceId: string | undefined): string {
  return instanceId ? `${QBIT_CACHE_VERSION_KEY}:${instanceId}` : QBIT_CACHE_VERSION_KEY;
}

export async function getQbitCacheVersion(instanceId: string | undefined): Promise<number> {
  try {
    const redis = await getRedisClient();
    const value = await redis.get(versionKey(instanceId));
    const parsed = value ? Number.parseInt(value, 10) : Number.NaN;
    // Missing key defaults to 0, matching INCR's create-at-1 semantics: the
    // FIRST bump must change the seed (defaulting to 1 would make it a no-op).
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export async function bumpQbitCacheVersion(instanceId: string | undefined): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.incr(versionKey(instanceId));
  } catch {
    // Best-effort: the 2s summary TTL is the backstop.
  }
}
