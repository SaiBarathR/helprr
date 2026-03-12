import { getRedisClient } from '@/lib/redis';
import { buildJellyfinLookupKey, stableStringify } from '@/lib/cache/keys';
import { getCacheGeneration } from '@/lib/cache/state';

const POSITIVE_TTL_MS = 10 * 60 * 1000;
const POSITIVE_STALE_MS = 30 * 60 * 1000;
const NEGATIVE_TTL_MS = 2 * 60 * 1000;

export type JellyfinLookupProvider = 'imdb' | 'tvdb' | 'tmdb';

interface JellyfinLookupCacheEntry {
  provider: JellyfinLookupProvider;
  providerId: string;
  itemId: string | null;
  fetchedAt: number;
  expiresAt: number;
  staleUntil: number;
}

function buildCacheSeed(provider: JellyfinLookupProvider, providerId: string): string {
  return stableStringify({
    provider,
    providerId,
  });
}

async function readEntry(provider: JellyfinLookupProvider, providerId: string): Promise<JellyfinLookupCacheEntry | null> {
  try {
    const generation = await getCacheGeneration();
    const redis = await getRedisClient();
    const raw = await redis.get(buildJellyfinLookupKey(generation, buildCacheSeed(provider, providerId)));
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<JellyfinLookupCacheEntry>;
    if (
      (parsed.provider !== 'imdb' && parsed.provider !== 'tvdb' && parsed.provider !== 'tmdb')
      || typeof parsed.providerId !== 'string'
      || (typeof parsed.itemId !== 'string' && parsed.itemId !== null)
      || typeof parsed.fetchedAt !== 'number'
      || typeof parsed.expiresAt !== 'number'
      || typeof parsed.staleUntil !== 'number'
    ) {
      return null;
    }

    return {
      provider: parsed.provider,
      providerId: parsed.providerId,
      itemId: parsed.itemId,
      fetchedAt: parsed.fetchedAt,
      expiresAt: parsed.expiresAt,
      staleUntil: parsed.staleUntil,
    };
  } catch {
    return null;
  }
}

export async function getCachedJellyfinLookup(
  provider: JellyfinLookupProvider,
  providerId: string
): Promise<{ itemId: string | null } | null> {
  const entry = await readEntry(provider, providerId);
  if (!entry) return null;

  const now = Date.now();
  if (now < entry.expiresAt) {
    return { itemId: entry.itemId };
  }

  if (entry.itemId && now < entry.staleUntil) {
    return { itemId: entry.itemId };
  }

  return null;
}

export async function setCachedJellyfinLookup(
  provider: JellyfinLookupProvider,
  providerId: string,
  itemId: string | null
): Promise<void> {
  try {
    const generation = await getCacheGeneration();
    const redis = await getRedisClient();
    const now = Date.now();
    const ttlMs = itemId ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS;
    const staleMs = itemId ? POSITIVE_STALE_MS : 0;
    const entry: JellyfinLookupCacheEntry = {
      provider,
      providerId,
      itemId,
      fetchedAt: now,
      expiresAt: now + ttlMs,
      staleUntil: now + ttlMs + staleMs,
    };
    const redisKey = buildJellyfinLookupKey(generation, buildCacheSeed(provider, providerId));
    await redis.set(redisKey, JSON.stringify(entry), {
      PX: Math.max(1, ttlMs + staleMs),
    });
  } catch {
    // noop
  }
}
