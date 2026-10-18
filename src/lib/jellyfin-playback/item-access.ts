import type { User } from '@prisma/client';
import { getRedisClient } from '@/lib/redis';
import { getJellyfinUserContext } from '@/lib/service-helpers';

const ITEM_ACCESS_TTL_SECONDS = 15 * 60;

const LIVE_TV_TYPES = new Set(['TvChannel', 'LiveTvChannel', 'Program', 'LiveTvProgram', 'TvProgram', 'Recording']);

export function isLiveTvItemType(type: string | null | undefined): boolean {
  return typeof type === 'string' && LIVE_TV_TYPES.has(type);
}

/**
 * Whether this Helprr user's Jellyfin account may use Live TV. Jellyfin applies
 * its Live TV policy only to /LiveTv routes called with the user's own token:
 * Helprr's catalog reads use the admin API key, and Jellyfin's item and media
 * routes serve a channel to any account, so Helprr checks the policy itself.
 * Cached like item access; any failure counts as no access.
 */
export async function canUserAccessLiveTv(user: Pick<User, 'role' | 'jellyfinUserId'>): Promise<boolean> {
  let context: Awaited<ReturnType<typeof getJellyfinUserContext>>;
  try {
    context = await getJellyfinUserContext(user);
  } catch {
    return false;
  }

  const cacheKey = `jellyfin:livetv-access:${context.connectionFingerprint}:${context.jellyfinUserId}`;
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === '1';
  } catch {
    // Redis unavailable — fall through to a live check.
  }

  let allowed: boolean;
  try {
    const { Policy: policy } = await context.client.getUser(context.jellyfinUserId);
    allowed = policy?.IsAdministrator === true || policy?.EnableLiveTvAccess === true;
  } catch {
    return false;
  }

  try {
    const redis = await getRedisClient();
    await redis.set(cacheKey, allowed ? '1' : '0', { EX: ITEM_ACCESS_TTL_SECONDS });
  } catch {
    // Best-effort cache write.
  }

  return allowed;
}

/**
 * Whether this Helprr user may read this Jellyfin item. Uses the same Redis
 * cache as `/api/jellyfin/image` so a poster grid and a stream session share
 * one upstream probe.
 */
export async function canUserAccessItem(user: User, itemId: string): Promise<boolean> {
  let context: Awaited<ReturnType<typeof getJellyfinUserContext>>;
  try {
    context = await getJellyfinUserContext(user);
  } catch {
    return false;
  }

  // v2: verdicts cached before the Live TV check allowed channels to anyone.
  // A visible Live TV item is cached as 'live', not as allowed, so the policy
  // (cached on its own) is consulted on every check and a revoked Live TV
  // permission is not extended by this cache.
  const cacheKey = `jellyfin:item-access:v2:${context.connectionFingerprint}:${context.jellyfinUserId}:${itemId.toLowerCase()}`;
  let visibility: string | null = null;
  try {
    const redis = await getRedisClient();
    visibility = await redis.get(cacheKey);
  } catch {
    // Redis unavailable — fall through to a live check.
  }

  if (visibility === null) {
    try {
      const result = await context.client.getItems({ ids: itemId, limit: 1 });
      const item = result.Items?.[0];
      visibility = item === undefined ? '0' : isLiveTvItemType(item.Type) ? 'live' : '1';
    } catch {
      return false;
    }
    try {
      const redis = await getRedisClient();
      await redis.set(cacheKey, visibility, { EX: ITEM_ACCESS_TTL_SECONDS });
    } catch {
      // Best-effort cache write.
    }
  }

  if (visibility === 'live') return canUserAccessLiveTv(user);
  return visibility === '1';
}

/** Drops Live TV items from a listing for an account without Live TV. */
export async function withoutLiveTvItems<T extends { Type?: string | null }>(
  user: Pick<User, 'role' | 'jellyfinUserId'>,
  items: T[],
): Promise<T[]> {
  if (!items.some((item) => isLiveTvItemType(item.Type))) return items;
  if (await canUserAccessLiveTv(user)) return items;
  return items.filter((item) => !isLiveTvItemType(item.Type));
}
