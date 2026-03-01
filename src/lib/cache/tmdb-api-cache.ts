import { getRedisClient } from '@/lib/redis';
import { buildTmdbDataKey, sha256Hex, stableStringify } from '@/lib/cache/keys';
import {
  TMDB_CACHE_STALE_SECONDS,
  TMDB_CACHE_DEFAULT_TTL_SECONDS,
} from '@/lib/cache/config';
import {
  getCacheGeneration,
  getCacheImagesEnabled,
  tryAcquireCacheLock,
} from '@/lib/cache/state';

interface TmdbCacheEntry<T> {
  endpoint: string;
  keyHash: string;
  payload: T;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

export interface TmdbCachePolicy {
  ttlSeconds?: number;
  staleSeconds?: number;
}

export interface TmdbCachedRequestOptions<T> {
  endpoint: string;
  params?: Record<string, unknown>;
  apiKey: string;
  policy?: TmdbCachePolicy;
  fetcher: () => Promise<T>;
}

function normalizeParams(params?: Record<string, unknown>): Record<string, unknown> {
  if (!params) return {};

  const normalized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined) continue;
    normalized[key] = value;
  }
  return normalized;
}

async function readEntry<T>(key: string): Promise<TmdbCacheEntry<T> | null> {
  try {
    const redis = await getRedisClient();
    const raw = await redis.get(key);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<TmdbCacheEntry<T>>;
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

async function writeEntry<T>(key: string, entry: TmdbCacheEntry<T>, nowMs: number): Promise<void> {
  try {
    const redis = await getRedisClient();
    const ttlSeconds = Math.max(1, Math.ceil((entry.staleUntil - nowMs) / 1000));
    await redis.set(key, JSON.stringify(entry), { EX: ttlSeconds });
  } catch {
    // noop
  }
}

export async function getTmdbJsonWithCache<T>(options: TmdbCachedRequestOptions<T>): Promise<T> {
  const enabled = await getCacheImagesEnabled();
  if (!enabled) {
    return options.fetcher();
  }

  const generation = await getCacheGeneration();
  const normalizedParams = normalizeParams(options.params);
  const cacheSeed = stableStringify({
    endpoint: options.endpoint,
    params: normalizedParams,
    apiKeyHash: sha256Hex(options.apiKey),
  });

  const redisKey = buildTmdbDataKey(generation, cacheSeed);
  const now = Date.now();
  const ttlSeconds = options.policy?.ttlSeconds ?? TMDB_CACHE_DEFAULT_TTL_SECONDS;
  const staleSeconds = options.policy?.staleSeconds ?? TMDB_CACHE_STALE_SECONDS;

  const cachedEntry = await readEntry<T>(redisKey);
  if (cachedEntry && now < cachedEntry.expiresAt) {
    return cachedEntry.payload;
  }

  const hasLock = await tryAcquireCacheLock('tmdb', `${generation}:${cacheSeed}`);
  if (!hasLock && cachedEntry && now < cachedEntry.staleUntil) {
    return cachedEntry.payload;
  }

  try {
    const payload = await options.fetcher();
    const nextEntry: TmdbCacheEntry<T> = {
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
  }
}
