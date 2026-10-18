import { getRedisClient } from '@/lib/redis';

// A live stream id names a stream Jellyfin has open (a tuner, for Live TV), and
// Jellyfin resolves it on its own, whatever item the request names. So the id
// is bound to the user and item it was opened for, and a request that carries
// one must match that binding: an id kept from a channel opened earlier cannot
// ride along on another item's request after Live TV access is gone.
//
// A play session id is the same kind of handle: Jellyfin serves an active
// transcode's media source to any request naming its play session, under any
// item's path. Every play session Helprr hands out comes from /stream/info, so
// each is bound there too, and the media proxy refuses one that is not this
// user's for this item. Live channels play through Jellyfin's legacy HLS routes,
// which pick a playlist by id and segments by file name whatever the item, so
// the playlist ids a served playlist names are bound the same way.

const TTL_SECONDS = 12 * 60 * 60;
type Kind = 'live-stream' | 'play-session' | 'hls-playlist';
// Ids are matched without case or dashes, as Jellyfin's are.
const normalize = (id: string) => id.toLowerCase().replace(/-/g, '');
const key = (kind: Kind, userId: string, id: string) => `jellyfin:${kind}:${userId}:${normalize(id)}`;

async function bind(kind: Kind, userId: string, id: string, itemId: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.set(key(kind, userId, id), normalize(itemId), { EX: TTL_SECONDS });
  } catch {
    // Without the binding the stream's later requests are refused: fail closed.
  }
}

async function belongsTo(kind: Kind, userId: string, id: string, itemId: string): Promise<boolean> {
  try {
    const redis = await getRedisClient();
    const matches = (await redis.get(key(kind, userId, id))) === normalize(itemId);
    // Playback can run for longer than the TTL: each use keeps the binding alive.
    if (matches) await redis.expire(key(kind, userId, id), TTL_SECONDS).catch(() => undefined);
    return matches;
  } catch {
    return false;
  }
}

export const bindLiveStream = (userId: string, liveStreamId: string, itemId: string) => bind('live-stream', userId, liveStreamId, itemId);
export const liveStreamBelongsTo = (userId: string, liveStreamId: string, itemId: string) => belongsTo('live-stream', userId, liveStreamId, itemId);
export const bindPlaySession = (userId: string, playSessionId: string, itemId: string) => bind('play-session', userId, playSessionId, itemId);
export const playSessionBelongsTo = (userId: string, playSessionId: string, itemId: string) => belongsTo('play-session', userId, playSessionId, itemId);
// Legacy HLS playlists (live channels) are bound when the proxy serves the playlist naming them.
export const bindHlsPlaylist = (userId: string, playlistId: string, itemId: string) => bind('hls-playlist', userId, playlistId, itemId);
export const hlsPlaylistBelongsTo = (userId: string, playlistId: string, itemId: string) => belongsTo('hls-playlist', userId, playlistId, itemId);
