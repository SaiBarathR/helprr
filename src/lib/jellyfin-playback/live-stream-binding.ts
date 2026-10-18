import { getRedisClient } from '@/lib/redis';

// A live stream id names a stream Jellyfin has open (a tuner, for Live TV), and
// Jellyfin resolves it on its own, whatever item the request names. So the id
// is bound to the user and item it was opened for, and a request that carries
// one must match that binding: an id kept from a channel opened earlier cannot
// ride along on another item's request after Live TV access is gone.

const TTL_SECONDS = 12 * 60 * 60;
const key = (userId: string, liveStreamId: string) => `jellyfin:live-stream:${userId}:${liveStreamId}`;

export async function bindLiveStream(userId: string, liveStreamId: string, itemId: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(key(userId, liveStreamId), itemId.toLowerCase(), { EX: TTL_SECONDS });
  } catch {
    // Without the binding the stream's later requests are refused: fail closed.
  }
}

export async function liveStreamBelongsTo(userId: string, liveStreamId: string, itemId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    return (await redis.get(key(userId, liveStreamId))) === itemId.toLowerCase();
  } catch {
    return false;
  }
}
