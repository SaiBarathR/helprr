import { randomBytes } from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { sha256Hex } from '@/lib/cache/keys';
import { resolveConnection } from '@/lib/arr-instances';

// Prowlarr, Sonarr, Radarr and Lidarr keep a searched release for 30 minutes.
const TOKEN_TTL_SECONDS = 30 * 60;

export interface ReleaseRef {
  guid: string;
  indexerId: number;
}

/**
 * A Prowlarr search result also keeps what sending it to Sonarr or Radarr
 * needs: its protocol and Prowlarr's download links, which carry Prowlarr's
 * API key, so they stay here with the guid.
 */
export interface ProwlarrReleaseRef extends ReleaseRef {
  protocol?: string;
  downloadUrl?: string;
  magnetUrl?: string;
}

/** Prowlarr's own search. Its keys predate the other scopes and keep their form. */
export const PROWLARR_SCOPE = 'prowlarr-release';

const SERVICE_TYPE = { sonarr: 'SONARR', radarr: 'RADARR', lidarr: 'LIDARR' } as const;
type ArrService = keyof typeof SERVICE_TYPE;

/** One Sonarr/Radarr/Lidarr instance's interactive search, by its connection id. */
export function arrReleaseScope(service: ArrService, connectionId: string): string {
  return `arr-release:${service}:${sha256Hex(connectionId)}`;
}

/**
 * The request's instance, resolved once (no instance id means the default):
 * its connection id, to build the client with, and its token scope. A token
 * then works whether or not the grab names the default instance, and never on
 * another instance after the default changes, even mid-search. Throws as
 * `resolveConnection` does for an unknown instance, before any token is read.
 */
export async function arrReleaseInstance(service: ArrService, instanceId?: string): Promise<{ id: string; scope: string }> {
  const { id } = await resolveConnection(SERVICE_TYPE[service], instanceId);
  return { id, scope: arrReleaseScope(service, id) };
}

function tokenKey(scope: string, userId: string, token: string): string {
  return `helprr:${scope}:v1:${sha256Hex(userId)}:${sha256Hex(token)}`;
}

/**
 * Stands in for a release in the browser. Grabbing needs the release's guid,
 * but for many indexers the guid is a download link that can carry a passkey,
 * so it stays on the server, readable only by the user who searched, and only
 * where they searched (`scope`). Each ref is kept as given (a Prowlarr ref
 * with its links).
 */
export async function issueReleaseTokens(scope: string, userId: string, releases: ReleaseRef[]): Promise<string[]> {
  const tokens = releases.map(() => randomBytes(24).toString('base64url'));
  if (releases.length === 0) return tokens;
  const redis = await getRedisClient();
  const batch = redis.multi();
  releases.forEach((release, index) => {
    batch.set(tokenKey(scope, userId, tokens[index]), JSON.stringify(release), { EX: TOKEN_TTL_SECONDS });
  });
  await batch.exec();
  return tokens;
}

export async function resolveReleaseToken<T extends ReleaseRef = ReleaseRef>(scope: string, userId: string, token: string): Promise<T | null> {
  const redis = await getRedisClient();
  const raw = await redis.get(tokenKey(scope, userId, token));
  return raw ? (JSON.parse(raw) as T) : null;
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
