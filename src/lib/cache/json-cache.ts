import { getRedisClient } from '@/lib/redis';
import { getCacheGeneration, getCacheImagesEnabled } from '@/lib/cache/state';
import { buildApiReadKey } from '@/lib/cache/keys';

// Generic short-TTL cache for hot read endpoints (sonarr/radarr/health/calendar). Mirrors
// library-gaps-cache: gates on the global cache toggle, folds the cache generation into the
// key so an admin purge invalidates everything, and is best-effort — any Redis failure falls
// through to a live fetch. No distributed lock (unlike tmdb/anilist) because the upstream is
// our own *arr instances, not a rate-limited third party. Always cache RAW upstream data and
// apply per-user permission filtering after the read so one user's data never leaks to another.

export async function getCachedJson<T>(scope: string, keySeed: string): Promise<T | null> {
  if (!(await getCacheImagesEnabled())) return null;
  try {
    const redis = await getRedisClient();
    const generation = await getCacheGeneration();
    const raw = await redis.get(buildApiReadKey(scope, generation, keySeed));
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null; // cache is best-effort — fall through to a live fetch
  }
}

export async function setCachedJson<T>(scope: string, keySeed: string, value: T, ttlSeconds: number): Promise<void> {
  if (!(await getCacheImagesEnabled())) return;
  try {
    const redis = await getRedisClient();
    const generation = await getCacheGeneration();
    await redis.set(buildApiReadKey(scope, generation, keySeed), JSON.stringify(value), {
      EX: ttlSeconds,
    });
  } catch {
    // noop — caching is best-effort
  }
}

// Drop one cached entry so the next read repopulates from upstream. Used by mutations
// (e.g. a collection monitor toggle) so the post-mutation refetch returns fresh data
// instead of replaying a stale entry for the rest of its TTL.
export async function deleteCachedJson(scope: string, keySeed: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    const generation = await getCacheGeneration();
    await redis.del(buildApiReadKey(scope, generation, keySeed));
  } catch {
    // noop — cache busting is best-effort; the short TTL is the backstop
  }
}
