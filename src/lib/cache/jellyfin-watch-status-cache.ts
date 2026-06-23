import { getRedisClient } from '@/lib/redis';
import { buildJellyfinWatchStatusKey, stableStringify } from '@/lib/cache/keys';
import {
  getCacheGeneration,
  releaseCacheLock,
  tryAcquireCacheLock,
} from '@/lib/cache/state';

// Per-user, on-demand watch-status cache. Same stale-while-revalidate shape as
// anilist-api-cache: fresh for TTL, served stale (and revalidated under a lock)
// for the stale window, so the bulk Jellyfin scan runs at most ~once / 10 min /
// user regardless of how many surfaces read the map. Keyed via getCacheGeneration
// so the global cache purge invalidates it too.

const TTL_SECONDS = 10 * 60;
const STALE_SECONDS = 30 * 60;
const LOCK_SCOPE = 'jellyfin-watch-status';
// The fetcher runs two full Jellyfin library scans, which can take much longer
// than the default cache-lock TTL — so the lock would expire mid-scan and let a
// second request start a duplicate scan. Hold the single-flight lock long enough
// to cover a slow scan.
const LOCK_TTL_MS = 60_000;
// On a cold key (no entry to serve stale), losers of the lock poll briefly for
// the winner's result instead of each running their own full scan (stampede).
const WAIT_ATTEMPTS = 10;
const WAIT_DELAY_MS = 300;

interface CacheEntry<T> {
  payload: T;
  expiresAt: number;
  staleUntil: number;
}

/** Library-wide map seed: identifies the connection + the member's Jellyfin user. */
export function watchStatusMapSeed(connectionFingerprint: string, jellyfinUserId: string): string {
  return stableStringify({ scope: 'map', connectionFingerprint, jellyfinUserId });
}

/** Per-series episode map seed: + the resolved Jellyfin series id. */
export function seriesEpisodesSeed(
  connectionFingerprint: string,
  jellyfinUserId: string,
  jellyfinSeriesId: string
): string {
  return stableStringify({ scope: 'episodes', connectionFingerprint, jellyfinUserId, jellyfinSeriesId });
}

async function readEntry<T>(key: string): Promise<CacheEntry<T> | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CacheEntry<T>>;
    if (
      typeof parsed.expiresAt !== 'number'
      || typeof parsed.staleUntil !== 'number'
      || !('payload' in parsed)
    ) {
      return null;
    }
    return { payload: parsed.payload as T, expiresAt: parsed.expiresAt, staleUntil: parsed.staleUntil };
  } catch {
    return null;
  }
}

async function writeEntry<T>(key: string, entry: CacheEntry<T>, nowMs: number): Promise<void> {
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.max(1, Math.ceil((entry.staleUntil - nowMs) / 1000));
    await redis.set(key, JSON.stringify(entry), { EX: ttlSeconds });
  } catch {
    // noop — a cache write failure must not fail the request.
  }
}

export async function getWatchStatusJson<T>(seed: string, fetcher: () => Promise<T>): Promise<T> {
  const generation = await getCacheGeneration();
  const key = buildJellyfinWatchStatusKey(generation, seed);
  const now = Date.now();

  const cached = await readEntry<T>(key);
  if (cached && now < cached.expiresAt) return cached.payload;

  const lockToken = await tryAcquireCacheLock(LOCK_SCOPE, `${generation}:${seed}`, LOCK_TTL_MS);
  if (!lockToken) {
    // Someone else is (re)building. Serve stale if we have it; otherwise (cold
    // key) wait briefly for their result rather than stampeding the bulk scan.
    if (cached && now < cached.staleUntil) return cached.payload;
    const awaited = await waitForFreshEntry<T>(key);
    if (awaited) return awaited;
    // Lock holder didn't deliver in time — fall through and rebuild ourselves.
  }

  try {
    const payload = await fetcher();
    const writtenAt = Date.now();
    await writeEntry(key, {
      payload,
      expiresAt: writtenAt + TTL_SECONDS * 1000,
      staleUntil: writtenAt + (TTL_SECONDS + STALE_SECONDS) * 1000,
    }, writtenAt);
    return payload;
  } catch (error) {
    if (cached && now < cached.staleUntil) return cached.payload;
    throw error;
  } finally {
    if (lockToken) {
      void releaseCacheLock(LOCK_SCOPE, `${generation}:${seed}`, lockToken);
    }
  }
}

/** Poll for an entry the lock holder is expected to write, so cold-cache losers
 * don't each run the full library scan. Returns null if it never appears. */
async function waitForFreshEntry<T>(key: string): Promise<T | null> {
  for (let attempt = 0; attempt < WAIT_ATTEMPTS; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, WAIT_DELAY_MS));
    const entry = await readEntry<T>(key);
    if (entry && Date.now() < entry.expiresAt) return entry.payload;
  }
  return null;
}

/** Drop a cached entry (by seed) so the next read revalidates — used after a write. */
export async function invalidateWatchStatus(seed: string): Promise<void> {
  try {
    const generation = await getCacheGeneration();
    const redis = await getRedisClient();
    await redis.del(buildJellyfinWatchStatusKey(generation, seed));
  } catch {
    // noop
  }
}
