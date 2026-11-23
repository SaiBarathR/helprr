import { randomBytes } from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { sha256Hex } from '@/lib/cache/keys';

// Prowlarr, Sonarr, Radarr and Lidarr keep a searched release for 30 minutes.
const TOKEN_TTL_SECONDS = 30 * 60;

export interface ReleaseRef {
  guid: string;
  indexerId: number;
}

/** Prowlarr's own search. Its keys predate the other scopes and keep their form. */
export const PROWLARR_SCOPE = 'prowlarr-release';

/** One Sonarr/Radarr/Lidarr instance's interactive search ('default' without an instance id). */
export function arrReleaseScope(service: 'sonarr' | 'radarr' | 'lidarr', instanceId?: string): string {
  return `arr-release:${service}:${sha256Hex(instanceId ?? 'default')}`;
}

function tokenKey(scope: string, userId: string, token: string): string {
  return `helprr:${scope}:v1:${sha256Hex(userId)}:${sha256Hex(token)}`;
}

/**
 * Stands in for a release in the browser. Grabbing needs the release's guid,
 * but for many indexers the guid is a download link that can carry a passkey,
 * so it stays on the server, readable only by the user who searched, and only
 * where they searched (`scope`).
 */
export async function issueReleaseTokens(scope: string, userId: string, releases: ReleaseRef[]): Promise<string[]> {
  const tokens = releases.map(() => randomBytes(24).toString('base64url'));
  if (releases.length === 0) return tokens;
  const redis = await getRedisClient();
  const batch = redis.multi();
  releases.forEach(({ guid, indexerId }, index) => {
    batch.set(tokenKey(scope, userId, tokens[index]), JSON.stringify({ guid, indexerId }), { EX: TOKEN_TTL_SECONDS });
  });
  await batch.exec();
  return tokens;
}

export async function resolveReleaseToken(scope: string, userId: string, token: string): Promise<ReleaseRef | null> {
  const redis = await getRedisClient();
  const raw = await redis.get(tokenKey(scope, userId, token));
  return raw ? (JSON.parse(raw) as ReleaseRef) : null;
}

/** Search results whose guid is a token for the real one (non-list answers are left alone). */
export async function withReleaseTokens<T extends { guid: string; indexerId: number }>(
  scope: string,
  userId: string,
  releases: T[],
): Promise<T[]> {
  if (!Array.isArray(releases)) return releases;
  const tokens = await issueReleaseTokens(scope, userId, releases.map(({ guid, indexerId }) => ({ guid, indexerId })));
  return releases.map((release, index) => ({ ...release, guid: tokens[index] }));
}
