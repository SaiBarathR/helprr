import { randomUUID } from 'crypto';
import { prisma } from '@/lib/db';
import { getRedisClient } from '@/lib/redis';
import { CACHE_LOCK_TTL_MS } from '@/lib/cache/config';
import { buildLockKey } from '@/lib/cache/keys';

const CACHE_IMAGES_SETTINGS_TTL_MS = 5_000;
const CACHE_GENERATION_KEY = 'helprr:cache:generation';
const CACHE_PURGE_STATUS_KEY = 'helprr:cache:purge:status';
const CACHE_LAST_PURGED_AT_KEY = 'helprr:cache:lastPurgedAt';

let cachedCacheImagesEnabled: boolean | null = null;
let cachedCacheImagesEnabledAt = 0;

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function parseGeneration(value: string | null): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return null;
  return parsed;
}

export async function getCacheImagesEnabled(options: { forceRefresh?: boolean } = {}): Promise<boolean> {
  const now = Date.now();
  if (!options.forceRefresh && cachedCacheImagesEnabled !== null && now - cachedCacheImagesEnabledAt <= CACHE_IMAGES_SETTINGS_TTL_MS) {
    return cachedCacheImagesEnabled;
  }

  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: { cacheImagesEnabled: true },
    });

    const enabled = isBoolean(settings?.cacheImagesEnabled) ? settings.cacheImagesEnabled : true;
    cachedCacheImagesEnabled = enabled;
    cachedCacheImagesEnabledAt = now;
    return enabled;
  } catch {
    // Fail-open so app features remain available if settings lookup fails.
    return true;
  }
}

export function setCachedCacheImagesEnabled(value: boolean): void {
  cachedCacheImagesEnabled = value;
  cachedCacheImagesEnabledAt = Date.now();
}

export interface AnilistTtlSettings {
  sectionsTtlMin: number;
  browseTtlMin: number;
  detailTtlMin: number;
  airingTtlMin: number;
}

export const DEFAULT_ANILIST_TTLS: AnilistTtlSettings = {
  sectionsTtlMin: 5,
  browseTtlMin: 10,
  detailTtlMin: 1440,
  airingTtlMin: 10,
};

let cachedAnilistTtls: AnilistTtlSettings | null = null;
let cachedAnilistTtlsAt = 0;

function sanitizeTtlMin(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : fallback;
}

/** Admin-configurable AniList cache TTLs (Settings → Anime mappings), memoized like the image flag. */
export async function getAnilistTtlSettings(): Promise<AnilistTtlSettings> {
  const now = Date.now();
  if (cachedAnilistTtls !== null && now - cachedAnilistTtlsAt <= CACHE_IMAGES_SETTINGS_TTL_MS) {
    return cachedAnilistTtls;
  }

  try {
    const settings = await prisma.appSettings.findUnique({
      where: { id: 'singleton' },
      select: {
        anilistSectionsTtlMin: true,
        anilistBrowseTtlMin: true,
        anilistDetailTtlMin: true,
        anilistAiringTtlMin: true,
      },
    });

    const next: AnilistTtlSettings = {
      sectionsTtlMin: sanitizeTtlMin(settings?.anilistSectionsTtlMin, DEFAULT_ANILIST_TTLS.sectionsTtlMin),
      browseTtlMin: sanitizeTtlMin(settings?.anilistBrowseTtlMin, DEFAULT_ANILIST_TTLS.browseTtlMin),
      detailTtlMin: sanitizeTtlMin(settings?.anilistDetailTtlMin, DEFAULT_ANILIST_TTLS.detailTtlMin),
      airingTtlMin: sanitizeTtlMin(settings?.anilistAiringTtlMin, DEFAULT_ANILIST_TTLS.airingTtlMin),
    };
    cachedAnilistTtls = next;
    cachedAnilistTtlsAt = now;
    return next;
  } catch {
    // Fail-open with defaults so AniList features keep working. Stamp the memo
    // window too, so a DB outage is retried once per window — not on every read.
    cachedAnilistTtls = cachedAnilistTtls ?? DEFAULT_ANILIST_TTLS;
    cachedAnilistTtlsAt = now;
    return cachedAnilistTtls;
  }
}

export function setCachedAnilistTtlSettings(value: AnilistTtlSettings): void {
  cachedAnilistTtls = value;
  cachedAnilistTtlsAt = Date.now();
}

export async function getCacheGeneration(): Promise<number> {
  try {
    const redis = await getRedisClient();
    const existing = parseGeneration(await redis.get(CACHE_GENERATION_KEY));
    if (existing) return existing;

    const initialized = await redis.set(CACHE_GENERATION_KEY, '1', { NX: true });
    if (initialized === 'OK') return 1;

    const afterInit = parseGeneration(await redis.get(CACHE_GENERATION_KEY));
    return afterInit ?? 1;
  } catch {
    return 1;
  }
}

export async function bumpCacheGeneration(): Promise<number> {
  try {
    const redis = await getRedisClient();
    const next = await redis.incr(CACHE_GENERATION_KEY);
    return Number.isFinite(next) && next > 0 ? next : 1;
  } catch {
    return 1;
  }
}

export async function getCachePurgeStatus(): Promise<'idle' | 'purging'> {
  try {
    const redis = await getRedisClient();
    const value = await redis.get(CACHE_PURGE_STATUS_KEY);
    return value === 'purging' ? 'purging' : 'idle';
  } catch {
    return 'idle';
  }
}

export async function setCachePurgeStatus(status: 'idle' | 'purging'): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(CACHE_PURGE_STATUS_KEY, status);
  } catch {
    // noop
  }
}

export async function getLastCachePurgedAt(): Promise<string | null> {
  try {
    const redis = await getRedisClient();
    return await redis.get(CACHE_LAST_PURGED_AT_KEY);
  } catch {
    return null;
  }
}

export async function setLastCachePurgedAt(value: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(CACHE_LAST_PURGED_AT_KEY, value);
  } catch {
    // noop
  }
}

export async function tryAcquireCacheLock(scope: string, keySeed: string, ttlMs = CACHE_LOCK_TTL_MS): Promise<string | null> {
  const token = randomUUID();
  try {
    const redis = await getRedisClient();
    const key = buildLockKey(scope, keySeed);
    const result = await redis.set(key, token, {
      NX: true,
      PX: Math.max(1, ttlMs),
    });
    return result === 'OK' ? token : null;
  } catch (error) {
    console.error('Failed to acquire cache lock', {
      scope,
      keySeed,
      ttlMs,
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    return null;
  }
}

export async function releaseCacheLock(scope: string, keySeed: string, token: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    const key = buildLockKey(scope, keySeed);
    const result = await redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0`,
      {
        keys: [key],
        arguments: [token],
      }
    );

    return Number(result) === 1;
  } catch {
    return false;
  }
}
