import crypto from 'crypto';

// A third copy of the enc:v1 format, on purpose: anilist-oauth.ts and
// jellyfin-token.ts each keep their own. This one imports nothing from the app
// so the worker can use it.
const ENCRYPTED_TOKEN_PREFIX = 'enc:v1:';

function getTokenEncryptionKey(): Buffer {
  const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
  if (!secret) {
    throw new Error('JWT_SECRET or APP_PASSWORD is required to store Twitch tokens securely');
  }
  return crypto.createHash('sha256').update(secret).digest();
}

export function encryptTwitchToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', getTokenEncryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${ENCRYPTED_TOKEN_PREFIX}${Buffer.concat([iv, tag, encrypted]).toString('base64')}`;
}

/** Null when absent, not enc:v1, or encrypted under a previous secret: callers treat all three as "no token". */
export function decryptTwitchToken(value: string | null | undefined): string | null {
  if (!value || !value.startsWith(ENCRYPTED_TOKEN_PREFIX)) return null;
  const payload = Buffer.from(value.slice(ENCRYPTED_TOKEN_PREFIX.length), 'base64');
  try {
    const decipher = crypto.createDecipheriv('aes-256-gcm', getTokenEncryptionKey(), payload.subarray(0, 12));
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([decipher.update(payload.subarray(28)), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}
