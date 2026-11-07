import { createHash, createHmac, randomUUID } from 'crypto';
import { Secret, TOTP } from 'otpauth';
import { SignJWT, jwtVerify } from 'jose';
import { NextResponse } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { getJwtSecret } from '@/lib/jwt-secret';
import { getRedisClient } from '@/lib/redis';
import { decryptTwitchToken, encryptTwitchToken } from '@/lib/twitch/token-cipher';

/**
 * Two-step sign-in for local accounts: an RFC 6238 authenticator code (or a
 * one-time recovery code) after the password.
 *
 * - The secret is stored with the same enc:v1 cipher as the Jellyfin token
 *   (token-cipher.ts is the app-free copy of it). It is written at setup and
 *   only asked for at sign-in once totpEnabledAt is set.
 * - A code is accepted once: totpLastUsedStep holds the last accepted 30-second
 *   step and only a later step passes, set in the same conditional update.
 * - A correct password for an account with two-step sign-in returns a short
 *   "MFA pending" token instead of a session. It is a signed JWT with its own
 *   audience and no session id, so the session checks never accept it. It is
 *   bound to the user and to their password, Jellyfin link and two-step state
 *   at the time, lasts five minutes, and works for one sign-in.
 * - Recovery codes are 80 random bits, so a plain SHA-256 is enough; they work
 *   after a JWT_SECRET change, when the encrypted secret no longer decrypts.
 * - On top of the sign-in throttles, a six-digit code gets its own caps: each
 *   attempt is counted before the code is checked (so parallel guesses cannot
 *   overshoot), 10 per account per hour across sign-in, setup and turning it
 *   off, and 5 per pending token, after which the password is needed again.
 */

const ISSUER = 'Helprr';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
// One step either side, for a phone clock that is a little off.
const WINDOW = 1;
const SECRET_BYTES = 20;

export const RECOVERY_CODE_COUNT = 10;
// 10 random bytes are 16 base32 characters.
const RECOVERY_CODE_BYTES = 10;
const RECOVERY_CODE_PATTERN = /^[A-Z2-7]{16}$/;
const TOTP_CODE_PATTERN = /^\d{6}$/;

export const MFA_PENDING_TTL_SECONDS = 5 * 60;
const MFA_PENDING_AUDIENCE = 'helprr:mfa-pending';
const MFA_PENDING_USED_KEY_PREFIX = 'login:mfa-used:';
const MFA_TOKEN_ATTEMPTS_KEY_PREFIX = 'login:mfa-token-attempts:';
const MFA_ACCOUNT_ATTEMPTS_KEY_PREFIX = 'login:mfa-account:';
const MFA_ATTEMPTS_PER_TOKEN = 5;
const MFA_ACCOUNT_MAX_ATTEMPTS = 10;
const MFA_ACCOUNT_WINDOW_MS = 60 * 60_000;

export type MfaSignInMethod = 'password' | 'jellyfin';
export type SecondFactor = 'totp' | 'recovery-code';

type TotpUser = Pick<User, 'id' | 'totpSecret' | 'totpEnabledAt'>;

function buildTotp(secret: Secret, label = 'Helprr'): TOTP {
  return new TOTP({ issuer: ISSUER, label, algorithm: 'SHA1', digits: DIGITS, period: PERIOD_SECONDS, secret });
}

export function isTotpEnabled(user: Pick<User, 'totpEnabledAt'>): boolean {
  return user.totpEnabledAt !== null;
}

/** A new secret to show once: the base32 key, the otpauth URI for a QR code, and what to store. */
export function createTotpSetup(username: string): { secret: string; uri: string; encryptedSecret: string } {
  const secret = new Secret({ size: SECRET_BYTES });
  return {
    secret: secret.base32,
    uri: buildTotp(secret, username).toString(),
    encryptedSecret: encryptTwitchToken(secret.base32),
  };
}

/** Spaces and dashes dropped, as typed or pasted. */
function normalizeCode(code: string): string {
  return code.replace(/[\s-]/g, '').toUpperCase();
}

/**
 * The 30-second step a code is valid for under this stored secret, or null.
 * Does not consume it.
 */
export function matchTotpStep(encryptedSecret: string | null, code: string, nowMs = Date.now()): number | null {
  const token = normalizeCode(code);
  if (!TOTP_CODE_PATTERN.test(token)) return null;
  const base32 = decryptTwitchToken(encryptedSecret);
  if (!base32) {
    if (encryptedSecret) {
      console.warn('[Auth] A two-step sign-in secret cannot be decrypted with the current secret; use a recovery code');
    }
    return null;
  }
  const delta = buildTotp(Secret.fromBase32(base32)).validate({ token, timestamp: nowMs, window: WINDOW });
  if (delta === null) return null;
  return Math.floor(nowMs / 1000 / PERIOD_SECONDS) + delta;
}

/**
 * Check an authenticator code for a user with two-step sign-in on, and use it
 * up: the conditional update only passes for a step later than the last one
 * accepted, so the same code (or an older one) never works twice.
 */
async function consumeTotpCode(user: TotpUser, code: string, nowMs: number): Promise<boolean> {
  if (!isTotpEnabled(user)) return false;
  const step = matchTotpStep(user.totpSecret, code, nowMs);
  if (step === null) return false;
  const updated = await prisma.user.updateMany({
    where: {
      id: user.id,
      totpEnabledAt: { not: null },
      totpSecret: user.totpSecret,
      OR: [{ totpLastUsedStep: null }, { totpLastUsedStep: { lt: step } }],
    },
    data: { totpLastUsedStep: step },
  });
  return updated.count === 1;
}

export function hashRecoveryCode(code: string): string {
  return createHash('sha256').update(normalizeCode(code), 'utf8').digest('hex');
}

/** Ten new codes, "ABCD-EFGH-IJKL-MNOP", and their hashes. */
export function generateRecoveryCodes(): { codes: string[]; hashes: string[] } {
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () =>
    new Secret({ size: RECOVERY_CODE_BYTES }).base32.match(/.{4}/g)!.join('-'),
  );
  return { codes, hashes: codes.map(hashRecoveryCode) };
}

/** Delete the matching recovery code; true when one was there to use. */
async function consumeRecoveryCode(user: TotpUser, code: string): Promise<boolean> {
  if (!isTotpEnabled(user)) return false;
  const normalized = normalizeCode(code);
  if (!RECOVERY_CODE_PATTERN.test(normalized)) return false;
  const deleted = await prisma.recoveryCode.deleteMany({
    where: { userId: user.id, codeHash: hashRecoveryCode(normalized) },
  });
  return deleted.count === 1;
}

/**
 * Check and use up a second factor: a six-digit authenticator code, or a
 * recovery code. Returns which one passed, or null.
 */
export async function consumeSecondFactor(user: TotpUser, code: string, nowMs = Date.now()): Promise<SecondFactor | null> {
  if (TOTP_CODE_PATTERN.test(normalizeCode(code))) {
    return (await consumeTotpCode(user, code, nowMs)) ? 'totp' : null;
  }
  return (await consumeRecoveryCode(user, code)) ? 'recovery-code' : null;
}

// ─── MFA pending token ──────────────────────────────────────────────────────

type StampUser = Pick<User, 'id' | 'passwordHash' | 'jellyfinUserId' | 'totpEnabledAt'>;

/**
 * Ties a pending token to the account as it was when the first step passed: a
 * password change, a Jellyfin relink, or two-step sign-in turned off (or on
 * again) ends it. An HMAC, so the token carries nothing about the hash.
 */
function credentialStamp(user: StampUser): string {
  return createHmac('sha256', getJwtSecret())
    .update(JSON.stringify(['mfa-stamp', user.id, user.passwordHash, user.jellyfinUserId, user.totpEnabledAt?.toISOString() ?? null]))
    .digest('base64url');
}

/**
 * `typedName` is the name typed at a Jellyfin sign-in when it is not the
 * Helprr username, so its sign-in backoff can be cleared once the code passes.
 */
export async function createMfaPendingToken(user: StampUser, method: MfaSignInMethod, typedName?: string): Promise<string> {
  return new SignJWT({ uid: user.id, method, stamp: credentialStamp(user), ...(typedName ? { name: typedName } : {}) })
    .setProtectedHeader({ alg: 'HS256' })
    .setAudience(MFA_PENDING_AUDIENCE)
    .setJti(randomUUID())
    .setIssuedAt()
    .setExpirationTime(`${MFA_PENDING_TTL_SECONDS}s`)
    .sign(getJwtSecret());
}

export interface MfaPendingClaims {
  userId: string;
  method: MfaSignInMethod;
  stamp: string;
  jti: string;
  expiresAtMs: number;
  typedName?: string;
}

/** The claims of a valid, unexpired pending token, or null. Does not check the user. */
export async function readMfaPendingToken(token: string): Promise<MfaPendingClaims | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret(), {
      algorithms: ['HS256'],
      audience: MFA_PENDING_AUDIENCE,
    });
    const { uid, method, stamp, jti, exp, name } = payload as Record<string, unknown>;
    if (typeof uid !== 'string' || typeof stamp !== 'string' || typeof jti !== 'string' || typeof exp !== 'number') return null;
    if (method !== 'password' && method !== 'jellyfin') return null;
    return {
      userId: uid,
      method,
      stamp,
      jti,
      expiresAtMs: exp * 1000,
      ...(typeof name === 'string' ? { typedName: name } : {}),
    };
  } catch {
    return null;
  }
}

/** Whether the user still has two-step sign-in on and has not changed since the token was made. */
export function mfaPendingTokenMatches(claims: MfaPendingClaims, user: StampUser): boolean {
  return claims.userId === user.id && isTotpEnabled(user) && claims.stamp === credentialStamp(user);
}

/**
 * Spend a pending token for one sign-in. False when it was already used.
 * Throws when Redis is unreachable, so the caller fails closed.
 */
export async function claimMfaPendingToken(claims: MfaPendingClaims, nowMs = Date.now()): Promise<boolean> {
  const redis = await getRedisClient();
  const ttlMs = Math.max(1_000, claims.expiresAtMs - nowMs + 1_000);
  const result = await redis.set(`${MFA_PENDING_USED_KEY_PREFIX}${claims.jti}`, '1', { NX: true, PX: ttlMs });
  return result === 'OK';
}

export type MfaAttemptGate =
  | { ok: true }
  | { ok: false; reason: 'used' | 'spent' }
  | { ok: false; reason: 'locked'; retryMs: number };

/**
 * Count one code attempt for the account (and the pending token, at sign-in)
 * before the code is checked. 'used': the token already signed in. 'spent':
 * this token had its tries. 'locked': the account's hourly cap is reached; the
 * window is fixed, so further tries do not extend it. Throws when Redis is
 * unreachable, so the caller fails closed.
 */
export async function startMfaAttempt(userId: string, claims?: MfaPendingClaims, nowMs = Date.now()): Promise<MfaAttemptGate> {
  const redis = await getRedisClient();
  const tokenTtlMs = claims ? Math.max(1_000, claims.expiresAtMs - nowMs + 1_000) : 1_000;
  const result = await redis.eval(
    `if ARGV[5] == '1' and redis.call('EXISTS', KEYS[2]) == 1 then return {'used', '0'} end
local n = redis.call('INCR', KEYS[1])
if n == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]) end
if n > tonumber(ARGV[2]) then return {'locked', tostring(redis.call('PTTL', KEYS[1]))} end
if ARGV[5] == '1' then
  local t = redis.call('INCR', KEYS[3])
  if t == 1 then redis.call('PEXPIRE', KEYS[3], ARGV[3]) end
  if t > tonumber(ARGV[4]) then return {'spent', '0'} end
end
return {'ok', '0'}`,
    {
      keys: [
        `${MFA_ACCOUNT_ATTEMPTS_KEY_PREFIX}${userId}`,
        `${MFA_PENDING_USED_KEY_PREFIX}${claims?.jti ?? 'none'}`,
        `${MFA_TOKEN_ATTEMPTS_KEY_PREFIX}${claims?.jti ?? 'none'}`,
      ],
      arguments: [
        String(MFA_ACCOUNT_WINDOW_MS),
        String(MFA_ACCOUNT_MAX_ATTEMPTS),
        String(tokenTtlMs),
        String(MFA_ATTEMPTS_PER_TOKEN),
        claims ? '1' : '0',
      ],
    },
  );
  const [reason, ttl] = Array.isArray(result) ? result.map(String) : [];
  if (reason === 'ok') return { ok: true };
  if (reason === 'used' || reason === 'spent') return { ok: false, reason };
  if (reason === 'locked') {
    const retryMs = Number(ttl);
    return { ok: false, reason: 'locked', retryMs: Number.isFinite(retryMs) && retryMs > 0 ? retryMs : MFA_ACCOUNT_WINDOW_MS };
  }
  throw new Error('Unexpected Redis result for the two-step attempt count');
}

/** A code passed: the account's attempt count starts again. Best effort. */
export async function clearMfaAttempts(userId: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.del(`${MFA_ACCOUNT_ATTEMPTS_KEY_PREFIX}${userId}`);
  } catch (error) {
    console.error('[Auth] Failed to clear two-step attempts:', error);
  }
}

/** The 429 for an account at its hourly cap. */
export function mfaLockedResponse(retryMs: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryMs / 1000));
  const minutes = Math.ceil(seconds / 60);
  return NextResponse.json(
    { error: `Too many wrong codes. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  );
}
