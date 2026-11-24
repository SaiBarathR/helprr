import { getRedisClient } from '@/lib/redis';

/**
 * .torrent files shared into the Android app, kept until the Add page that the
 * share opens picks them up.
 *
 * The share target's POST can only answer with a redirect, and a redirect
 * can't carry a file, so the server keeps it in between: one slot per user
 * (a new share replaces the last one), 15 minutes, at most 4 MB in all.
 * Redis is capped with noeviction in production, so the slot is small and
 * per user rather than per share. Only the user who shared can read it back.
 */
export interface SharedTorrentFile {
  name: string;
  bytes: Uint8Array;
}

export const SHARED_TORRENTS_TTL_SECONDS = 15 * 60;
export const MAX_SHARED_TORRENT_BYTES = 4 * 1024 * 1024;
export const MAX_SHARED_TORRENT_FILES = 20;

function sharedTorrentsKey(userId: string): string {
  return `helprr:share:torrents:${userId}`;
}

export async function keepSharedTorrents(userId: string, files: SharedTorrentFile[]): Promise<void> {
  const redis = await getRedisClient();
  const value = JSON.stringify(files.map((file) => ({ name: file.name, data: Buffer.from(file.bytes).toString('base64') })));
  await redis.set(sharedTorrentsKey(userId), value, { EX: SHARED_TORRENTS_TTL_SECONDS });
}

/** The user's shared files as base64, or null once they have expired. */
export async function readSharedTorrents(userId: string): Promise<Array<{ name: string; data: string }> | null> {
  const redis = await getRedisClient();
  const raw = await redis.get(sharedTorrentsKey(userId));
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!Array.isArray(parsed)) return null;
  return parsed.filter((item): item is { name: string; data: string } =>
    typeof item?.name === 'string' && typeof item?.data === 'string');
}
