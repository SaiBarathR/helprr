import type { User } from '@prisma/client';
import { getRedisClient } from '@/lib/redis';
import { getJellyfinUserContext } from '@/lib/service-helpers';

const ITEM_ACCESS_TTL_SECONDS = 15 * 60;

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
    allowed = (result.Items?.length ?? 0) > 0;
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
