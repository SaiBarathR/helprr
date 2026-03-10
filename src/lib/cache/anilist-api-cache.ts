import { getRedisClient } from '@/lib/redis';
import { buildAnilistDataKey, sha256Hex, stableStringify } from '@/lib/cache/keys';
import {
  getCacheGeneration,
  getCacheImagesEnabled,
  releaseCacheLock,
  tryAcquireCacheLock,
} from '@/lib/cache/state';

interface AnilistCacheEntry<T> {
  endpoint: string;
  keyHash: string;
  payload: T;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface AnilistCachePolicy {
  ttlSeconds?: number;
  staleSeconds?: number;
}

export interface AnilistCachedRequestOptions<T> {
  endpoint: string;
  params?: Record<string, unknown>;
  policy?: AnilistCachePolicy;
  fetcher: () => Promise<T>;
}

const DEFAULT_TTL_SECONDS = 10 * 60;
const DEFAULT_STALE_SECONDS = 60 * 60;

async function readEntry<T>(key: string): Promise<AnilistCacheEntry<T> | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<AnilistCacheEntry<T>>;
    if (
      typeof parsed.endpoint !== 'string'
      || typeof parsed.keyHash !== 'string'
      || typeof parsed.fetchedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.staleUntil !== 'number'
      || !('payload' in parsed)
    ) {
      return null;
    }

    return {
      endpoint: parsed.endpoint,
      keyHash: parsed.keyHash,
      payload: parsed.payload as T,
      fetchedAt: parsed.fetchedAt,
      expiresAt: parsed.expiresAt,
      staleUntil: parsed.staleUntil,
    };
  } catch {
    return null;
  }
}

async function writeEntry<T>(key: string, entry: AnilistCacheEntry<T>, nowMs: number): Promise<void> {
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.max(1, Math.ceil((entry.staleUntil - nowMs) / 1000));
    await redis.set(key, JSON.stringify(entry), { EX: ttlSeconds });
  } catch {
    // noop
  }
}

export async function getAnilistJsonWithCache<T>(options: AnilistCachedRequestOptions<T>): Promise<T> {
  const enabled = await getCacheImagesEnabled();
  if (!enabled) {
    return options.fetcher();
  }

  const generation = await getCacheGeneration();
  const cacheSeed = stableStringify({
    endpoint: options.endpoint,
    params: options.params ?? {},
  });

  const redisKey = buildAnilistDataKey(generation, cacheSeed);
  const now = Date.now();
  const ttlSeconds = options.policy?.ttlSeconds ?? DEFAULT_TTL_SECONDS;
  const staleSeconds = options.policy?.staleSeconds ?? DEFAULT_STALE_SECONDS;

  const cachedEntry = await readEntry<T>(redisKey);
  if (cachedEntry && now < cachedEntry.expiresAt) {
    return cachedEntry.payload;
  }

  const lockToken = await tryAcquireCacheLock('anilist', `${generation}:${cacheSeed}`);
  if (!lockToken && cachedEntry && now < cachedEntry.staleUntil) {
    return cachedEntry.payload;
  }

  try {
    const payload = await options.fetcher();
    const nextEntry: AnilistCacheEntry<T> = {
      endpoint: options.endpoint,
      keyHash: sha256Hex(cacheSeed),
      payload,
      fetchedAt: now,
      expiresAt: now + ttlSeconds * 1000,
      staleUntil: now + (ttlSeconds + staleSeconds) * 1000,
    };
    await writeEntry(redisKey, nextEntry, now);
    return payload;
  } catch (error) {
    if (cachedEntry && now < cachedEntry.staleUntil) {
      return cachedEntry.payload;
    }
    throw error;
  } finally {
    if (lockToken) {
      void releaseCacheLock('anilist', `${generation}:${cacheSeed}`, lockToken);
    }
  }
}
