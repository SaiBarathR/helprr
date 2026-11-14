import crypto from 'crypto';

/**
 * A 32-byte key derived from this install's secret, `JWT_SECRET` (or
 * `APP_PASSWORD` when that is unset). Each install has its own secret, so
 * anything derived from this key differs from one install to the next even
 * when they share upstream services. Rotating the secret changes the key.
 *
 * Throws when neither is set: every caller protects or identifies something
 * with it, and a guessable fallback would defeat that. `purpose` finishes the
 * error message.
 */
export function getInstallKey(purpose: string): Buffer {
  const secret = process.env.JWT_SECRET || process.env.APP_PASSWORD;
  if (!secret) {
    throw new Error(`JWT_SECRET or APP_PASSWORD is required to ${purpose}`);
  }
  return crypto.createHash('sha256').update(secret).digest();
}
