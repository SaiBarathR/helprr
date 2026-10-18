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
 * Cached like item access. Throws when the policy cannot be read, so a caller
 * can tell a Jellyfin failure from a refusal; canUserAccessLiveTv fails closed.
 */
export async function liveTvAccess(user: Pick<User, 'role' | 'jellyfinUserId'>): Promise<boolean> {
  const context = await getJellyfinUserContext(user);

  const cacheKey = `jellyfin:livetv-access:${context.connectionFingerprint}:${context.jellyfinUserId}`;
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === '1';
  } catch {
    // Redis unavailable — fall through to a live check.
  }

  const { Policy: policy } = await context.client.getUser(context.jellyfinUserId);
  const allowed = policy?.IsAdministrator === true || policy?.EnableLiveTvAccess === true;

  try {
    const redis = await getRedisClient();
    await redis.set(cacheKey, allowed ? '1' : '0', { EX: ITEM_ACCESS_TTL_SECONDS });
  } catch {
    // Best-effort cache write.
  }

  return allowed;
}

/** liveTvAccess, failing closed: any failure counts as no access. */
export function canUserAccessLiveTv(user: Pick<User, 'role' | 'jellyfinUserId'>): Promise<boolean> {
  return liveTvAccess(user).catch(() => false);
}

/**
 * Whether this Helprr user may read this Jellyfin item. Uses the same Redis
 * cache as `/api/jellyfin/image` so a poster grid and a stream session share
 * one upstream probe. Throws when Jellyfin cannot be asked; canUserAccessItem
 * fails closed instead.
 */
export async function itemAccess(user: User, itemId: string): Promise<boolean> {
  const context = await getJellyfinUserContext(user);

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
    const result = await context.client.getItems({ ids: itemId, limit: 1 });
    const item = result.Items?.[0];
    visibility = item === undefined ? '0' : isLiveTvItemType(item.Type) ? 'live' : '1';
    try {
      const redis = await getRedisClient();
      await redis.set(cacheKey, visibility, { EX: ITEM_ACCESS_TTL_SECONDS });
    } catch {
      // Best-effort cache write.
    }
  }

  if (visibility === 'live') return liveTvAccess(user);
  return visibility === '1';
}

/** itemAccess, failing closed: any failure counts as no access. */
export function canUserAccessItem(user: User, itemId: string): Promise<boolean> {
  return itemAccess(user, itemId).catch(() => false);
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
