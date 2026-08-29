import crypto from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';

/**
 * At-rest storage for a member's Jellyfin AccessToken.
 *
 * Jellyfin resolves a session's user from the token alone — the
 * `/Sessions/Playing*` models carry no UserId field — so an admin-API-key
 * session has no user and Jellyfin attributes nothing to it. Playing as the
 * member therefore requires the member's own token, which only they can mint
 * (Jellyfin has no impersonation endpoint).
 *
 * Unlike `ServiceConnection.apiKey`, this is a per-user credential, so it is
 * encrypted at rest. The scheme is deliberately identical to the AniList token
 * store in `anilist-oauth.ts` — same AES-256-GCM construction, same key
 * derivation, same prefix marker — so the two behave the same way when the
 * app secret rotates. It is duplicated rather than shared because extracting it
 * would mean editing a working, unrelated module.
 */
const ENCRYPTED_TOKEN_PREFIX = 'enc:v1:';

function getTokenEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
  if (!secret) {
    throw new Error('JWT_SECRET or APP_PASSWORD is required to store Jellyfin tokens securely');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

function encryptToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_TOKEN_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

function decryptToken(value: string): string | null {
  const payload = Buffer.from(value.slice(ENCRYPTED_TOKEN_PREFIX.length), 'base64');
  const iv = payload.subarray(0, 12);
  const tag = payload.subarray(12, 28);
  const encrypted = payload.subarray(28);
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getTokenEncryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  } catch {
    // Encrypted under a previous JWT_SECRET/APP_PASSWORD. Treat as absent so the
    // member is asked to reconnect, rather than 500ing every playback request.
    console.warn('[Jellyfin] Stored token cannot be decrypted with the current secret; reconnect required');
    return null;
  }
}

/** Persist a freshly minted AccessToken for a member. */
export async function storeJellyfinToken(userId: string, accessToken: string): Promise<void> {
  await prisma.user.update({
    where: { id: userId },
    data: { jellyfinToken: encryptToken(accessToken) },
  });
}

/**
 * The member's usable Jellyfin token, or null when they have none, it predates
 * a secret rotation, or it has been invalidated. Takes the already-loaded user
 * row — `requireUser` hands every authenticated route the full record, so
 * reading the token costs no extra query.
 *
 * Tokens written before encryption landed are stored as plaintext and have no
 * prefix; they are returned as-is and get upgraded on the next write.
 */
export function readJellyfinToken(user: Pick<User, 'jellyfinToken'>): string | null {
  const stored = user.jellyfinToken;
  if (!stored) return null;
  if (!stored.startsWith(ENCRYPTED_TOKEN_PREFIX)) return stored;
  return decryptToken(stored);
}

/**
 * Drop a token Jellyfin has stopped accepting. A Jellyfin admin deleting the
 * device in Dashboard → Devices revokes it silently, so the only signal is a
 * 401/403 on a playback call.
 */
export async function invalidateJellyfinToken(userId: string): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { jellyfinToken: null } });
}
