import axios from 'axios';
import { getRedisClient } from '@/lib/redis';
import { sha256Hex } from '@/lib/cache/keys';
import { getProwlarrClient } from '@/lib/service-helpers';
import { PROWLARR_SCOPE, resolveReleaseToken, type ProwlarrReleaseRef } from '@/lib/release-tokens';
import { parseMagnet, parseTorrentFile, ReleaseSourceError, type ReleaseSource } from './release-source';
import { ManualDownloadRequestError } from './request';

/**
 * A Prowlarr search result as a manual-download release. The browser names it
 * only by the release token from its search; the links stay on the server.
 * The release is fetched through Prowlarr once (each fetch is a grab in
 * Prowlarr's history and a hit on the indexer), then kept for the token's
 * life so a Check and the Send that follows read the same release.
 */

const SOURCE_TTL_SECONDS = 30 * 60;
export const PROWLARR_RELEASE_EXPIRED = 'This result has expired. Search again.';

type CachedSource = { kind: 'MAGNET'; magnetUrl: string } | { kind: 'TORRENT_FILE'; torrent: string };

function sourceKey(userId: string, token: string): string {
  return `helprr:prowlarr-release-source:v1:${sha256Hex(userId)}:${sha256Hex(token)}`;
}

function readSource(cached: CachedSource): ReleaseSource {
  return cached.kind === 'MAGNET' ? parseMagnet(cached.magnetUrl) : parseTorrentFile(Buffer.from(cached.torrent, 'base64'));
}

/** Why a fetch failed, in words that quote no link. */
function fetchProblem(error: unknown): string {
  // Its messages name what is wrong with the torrent, never a link.
  if (error instanceof ReleaseSourceError) return error.message;
  if (axios.isAxiosError(error)) {
    if (error.response?.status === 429) return 'The indexer is limiting requests. Try again in a minute.';
    return 'Prowlarr could not fetch this release from the indexer. Try again, or pick another result.';
  }
  return error instanceof Error && error.message.startsWith('Prowlarr ') ? error.message : 'Prowlarr could not fetch this release.';
}

/**
 * The release behind a Prowlarr search token, for the user who searched.
 * Throws ManualDownloadRequestError: 410 once the token has expired, 400 for a
 * Usenet release (manual downloads follow torrents only), 502 when Prowlarr
 * cannot fetch it. The magnet link is tried before the .torrent: it needs no
 * callback to Helprr, and a proxied .torrent is the link that fails more often.
 */
export async function prowlarrReleaseSource(userId: string, token: string): Promise<ReleaseSource> {
  const release = await resolveReleaseToken<ProwlarrReleaseRef>(PROWLARR_SCOPE, userId, token);
  if (!release) throw new ManualDownloadRequestError(PROWLARR_RELEASE_EXPIRED, 410);
  if (release.protocol !== 'torrent') throw new ManualDownloadRequestError('Only torrent releases can be sent to Sonarr or Radarr.');

  const redis = await getRedisClient();
  const key = sourceKey(userId, token);
  const cached = await redis.get(key);
  if (cached) return readSource(JSON.parse(cached) as CachedSource);

  const links = [...new Set([release.magnetUrl, release.downloadUrl].filter((link): link is string => typeof link === 'string' && link.length > 0))];
  if (links.length === 0) throw new ManualDownloadRequestError('Prowlarr gave no download link for this release.');
  let client: Awaited<ReturnType<typeof getProwlarrClient>>;
  try {
    client = await getProwlarrClient();
  } catch {
    throw new ManualDownloadRequestError('Prowlarr is not connected.', 409);
  }
  let problem: unknown = null;
  for (const link of links) {
    try {
      const fetched = await client.fetchReleaseLink(link);
      const stored: CachedSource = fetched.kind === 'MAGNET'
        ? { kind: 'MAGNET', magnetUrl: fetched.magnetUrl }
        : { kind: 'TORRENT_FILE', torrent: fetched.bytes.toString('base64') };
      const source = readSource(stored);
      await redis.set(key, JSON.stringify(stored), { EX: SOURCE_TTL_SECONDS });
      return source;
    } catch (error) {
      problem = error;
    }
  }
  throw new ManualDownloadRequestError(fetchProblem(problem), 502);
}
