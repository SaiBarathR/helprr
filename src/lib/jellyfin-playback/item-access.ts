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

  const cacheKey = `jellyfin:item-access:${context.connectionFingerprint}:${context.jellyfinUserId}:${itemId.toLowerCase()}`;
  try {
    const redis = await getRedisClient();
    const cached = await redis.get(cacheKey);
    if (cached !== null) return cached === '1';
  } catch {
    // Redis unavailable — fall through to a live check.
  }

  let allowed: boolean;
  try {
    const result = await context.client.getItems({ ids: itemId, limit: 1 });
    const item = result.Items?.[0];
    allowed = item !== undefined && (!isLiveTvItemType(item.Type) || await canUserAccessLiveTv(user));
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
