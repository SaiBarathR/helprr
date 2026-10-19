import { randomBytes } from 'crypto';
import { getRedisClient } from '@/lib/redis';

/**
 * A .torrent file waiting for Arr to fetch it. Arr has no upload endpoint: it
 * fetches a pushed release's URL once, during the push, with no credentials.
 * So the bytes wait in Redis under an unguessable token, for two minutes, and
 * the first fetch takes them (GETDEL). The token is never stored or logged.
 */

const KEY_PREFIX = 'helprr:manual-download:torrent:';
const TTL_SECONDS = 120;
export const TORRENT_LINK_PATH = '/api/manual-downloads/torrent/';
/** 32 random bytes, base64url: 43 characters. */
export const TORRENT_TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export async function offerTorrentToArr(bytes: Buffer, origin: string): Promise<string> {
  const token = randomBytes(32).toString('base64url');
  const redis = await getRedisClient();
  await redis.set(`${KEY_PREFIX}${token}`, bytes.toString('base64'), { EX: TTL_SECONDS });
  return `${origin}${TORRENT_LINK_PATH}${token}`;
}

/** The waiting .torrent for this token, at most once; null when unknown, used or expired. */
export async function takeTorrentForArr(token: string): Promise<Buffer | null> {
  if (!TORRENT_TOKEN_PATTERN.test(token)) return null;
  const redis = await getRedisClient();
  const value = await redis.getDel(`${KEY_PREFIX}${token}`);
  return value ? Buffer.from(value, 'base64') : null;
}

/** Drop a link Arr never fetched (the push failed before reaching it). */
export async function withdrawTorrentLink(url: string): Promise<void> {
  const token = url.slice(url.lastIndexOf('/') + 1);
  if (!TORRENT_TOKEN_PATTERN.test(token)) return;
  const redis = await getRedisClient();
  await redis.del(`${KEY_PREFIX}${token}`);
}
