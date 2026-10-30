import { randomBytes } from 'crypto';
import { getRedisClient } from '@/lib/redis';
import { sha256Hex } from '@/lib/cache/keys';

// Prowlarr keeps a searched release for 30 minutes.
const TOKEN_TTL_SECONDS = 30 * 60;

export interface ReleaseRef {
  guid: string;
  indexerId: number;
}

function tokenKey(userId: string, token: string): string {
  return `helprr:prowlarr-release:v1:${sha256Hex(userId)}:${sha256Hex(token)}`;
}

/**
 * Stands in for a release in the browser. Grabbing needs the release's guid,
 * but for many indexers the guid is a download link that can carry a passkey,
 * so it stays on the server, readable only by the user who searched.
 */
export async function issueReleaseTokens(userId: string, releases: ReleaseRef[]): Promise<string[]> {
  const tokens = releases.map(() => randomBytes(24).toString('base64url'));
  if (releases.length === 0) return tokens;
  const redis = await getRedisClient();
  const batch = redis.multi();
  releases.forEach(({ guid, indexerId }, index) => {
    batch.set(tokenKey(userId, tokens[index]), JSON.stringify({ guid, indexerId }), { EX: TOKEN_TTL_SECONDS });
  });
  await batch.exec();
  return tokens;
}

export async function resolveReleaseToken(userId: string, token: string): Promise<ReleaseRef | null> {
  const redis = await getRedisClient();
  const raw = await redis.get(tokenKey(userId, token));
  return raw ? (JSON.parse(raw) as ReleaseRef) : null;
}
