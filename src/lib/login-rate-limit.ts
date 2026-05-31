import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'net';
import { createHash } from 'crypto';
import { getRedisClient } from '@/lib/redis';

// Layered brute-force defense for the login endpoints (local password and
// "Sign in with Jellyfin"), per OWASP / AWS-Cognito guidance:
//   1. IP bucket (below) — 5/min per trusted client IP. Requires a sanitized
//      reverse proxy (TRUST_FORWARDED_PROTO); skipped otherwise to avoid trusting
//      a forgeable x-forwarded-for.
//   2. Per-username exponential backoff (further down) — always on, so a default
//      deployment without a trusted proxy IP still throttles guessing of a known
//      username. Auto-recovers (capped delay) so it can't be weaponized into a
//      permanent account lockout, and ignores a replayed identical wrong password
//      so a legitimate user isn't locked out by credential-stuffing noise.
// Both routes funnel through the same Redis keys so an attacker can't sidestep a
// cap by alternating endpoints.

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_WINDOW_SECONDS = Math.max(1, Math.ceil(LOGIN_WINDOW_MS / 1000));
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_ATTEMPTS_KEY_PREFIX = 'login:attempts:';

// Per-username backoff tuning (mirrors AWS Cognito: 5 failures → 1s, doubling,
// capped at 15 min).
const USER_LOCK_THRESHOLD = 5;
const USER_BACKOFF_BASE_MS = 1_000;
const USER_BACKOFF_MAX_MS = 15 * 60 * 1_000;
const USER_KEY_TTL_MS = USER_BACKOFF_MAX_MS;
const USER_ATTEMPTS_KEY_PREFIX = 'login:user:';

function formatWindowDuration(ms: number): string {
  const totalSeconds = Math.max(1, Math.ceil(ms / 1000));
  if (totalSeconds % 60 === 0) {
    const minutes = totalSeconds / 60;
    return `${minutes} minute${minutes === 1 ? '' : 's'}`;
  }
  return `${totalSeconds} second${totalSeconds === 1 ? '' : 's'}`;
}

const LOGIN_WINDOW_TEXT = formatWindowDuration(LOGIN_WINDOW_MS);

export function getClientIp(request: NextRequest): string | undefined {
  // Without a sanitized reverse proxy, x-forwarded-* is attacker-controlled
  // — feeding it into rate limiting lets one client trivially bypass the
  // 5/min cap by rotating the header, and persisting it into Session.ip
  // would store a forged value. TRUST_FORWARDED_PROTO is the same gate the
  // login response already uses for the Secure cookie flag.
  if (process.env.TRUST_FORWARDED_PROTO !== 'true') return undefined;

  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const [firstIp] = forwardedFor.split(',');
    const trimmed = firstIp?.trim();
    if (trimmed && isIP(trimmed) !== 0) return trimmed;
  }
  const realIp = request.headers.get('x-real-ip')?.trim();
  if (realIp && isIP(realIp) !== 0) return realIp;
  return undefined;
}

function attemptsKey(ip: string): string {
  return `${LOGIN_ATTEMPTS_KEY_PREFIX}${ip}`;
}

async function incrementAttempts(ip: string): Promise<number> {
  const redis = await getRedisClient();
  const key = attemptsKey(ip);
  const result = await redis.eval(
    `local attempts = redis.call('INCR', KEYS[1])
if attempts == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return attempts`,
    {
      keys: [key],
      arguments: [String(LOGIN_WINDOW_MS)],
    }
  );

  const attempts = Number(result);
  if (!Number.isFinite(attempts)) {
    throw new Error('Unexpected Redis result for login attempts');
  }

  return attempts;
}

export async function clearLoginAttempts(ip: string): Promise<void> {
  const redis = await getRedisClient();
  await redis.del(attemptsKey(ip));
}

/**
 * Increment the attempt counter for `ip` and return a 429/503 response if the
 * cap is exceeded or Redis is unreachable, or null when the request may proceed.
 *
 * No trusted IP means no safe per-client key — skip the bucket entirely rather
 * than collapse every caller into a shared bucket (which would let one attacker
 * exhaust the global cap and lock everyone out).
 */
export async function enforceLoginRateLimit(ip: string | undefined): Promise<NextResponse | null> {
  if (ip === undefined) return null;

  let attempts: number;
  try {
    attempts = await incrementAttempts(ip);
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }

  if (attempts > LOGIN_MAX_ATTEMPTS) {
    return NextResponse.json(
      { error: `Too many login attempts. Try again in ${LOGIN_WINDOW_TEXT}.` },
      {
        status: 429,
        headers: { 'Retry-After': String(LOGIN_WINDOW_SECONDS) },
      }
    );
  }

  return null;
}

// ─── Per-username exponential backoff (layer 2) ──────────────────────────────

function userKey(username: string): string {
  return `${USER_ATTEMPTS_KEY_PREFIX}${username.trim().toLowerCase()}`;
}

// sha256 only to dedupe a replayed identical wrong password — not a security
// hash, and the plaintext is never persisted.
function passwordFingerprint(password: string): string {
  return createHash('sha256').update(password).digest('hex');
}

function lockedResponse(retryMs: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryMs / 1000));
  return NextResponse.json(
    { error: `Too many login attempts. Try again in ${formatWindowDuration(retryMs)}.` },
    { status: 429, headers: { 'Retry-After': String(seconds) } }
  );
}

/**
 * Reject with 429 if `username` is currently in backoff. Call BEFORE verifying the
 * password so a locked account short-circuits the (expensive) hash comparison.
 * Returns a 503 if Redis is unreachable — the throttle fails closed rather than open.
 */
export async function enforceUsernameBackoff(username: string): Promise<NextResponse | null> {
  let lockedUntil = 0;
  try {
    const redis = await getRedisClient();
    const raw = await redis.eval(`return redis.call('HGET', KEYS[1], 'lockedUntil')`, {
      keys: [userKey(username)],
    });
    lockedUntil = raw ? Number(raw) : 0;
  } catch {
    return NextResponse.json({ error: 'Login service unavailable' }, { status: 503 });
  }

  if (Number.isFinite(lockedUntil) && lockedUntil > Date.now()) {
    return lockedResponse(lockedUntil - Date.now());
  }
  return null;
}

/**
 * Record a failed attempt for `username` and extend the backoff. A replayed
 * identical wrong password (same fingerprint as the previous failure) does NOT
 * advance the counter, so credential-stuffing the same leaked password can't lock
 * out a legitimate user. Best-effort: a Redis error is logged, not surfaced.
 */
export async function recordUsernameFailure(username: string, password: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.eval(
      `local lastHash = redis.call('HGET', KEYS[1], 'lastPwHash')
local count = tonumber(redis.call('HGET', KEYS[1], 'count') or '0')
if lastHash ~= ARGV[1] then
  count = count + 1
  redis.call('HSET', KEYS[1], 'count', count, 'lastPwHash', ARGV[1])
end
local now = tonumber(ARGV[2])
local threshold = tonumber(ARGV[3])
local lockedUntil = 0
if count >= threshold then
  local backoff = tonumber(ARGV[4]) * (2 ^ (count - threshold))
  local maxMs = tonumber(ARGV[5])
  if backoff > maxMs then backoff = maxMs end
  lockedUntil = now + backoff
  redis.call('HSET', KEYS[1], 'lockedUntil', lockedUntil)
end
redis.call('PEXPIRE', KEYS[1], ARGV[6])
return tostring(lockedUntil)`,
      {
        keys: [userKey(username)],
        arguments: [
          passwordFingerprint(password),
          String(Date.now()),
          String(USER_LOCK_THRESHOLD),
          String(USER_BACKOFF_BASE_MS),
          String(USER_BACKOFF_MAX_MS),
          String(USER_KEY_TTL_MS),
        ],
      }
    );
  } catch (error) {
    console.error('[Auth] Failed to record username login failure:', error);
  }
}

/** Clear a username's backoff state on successful login. */
export async function clearUsernameBackoff(username: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.del(userKey(username));
  } catch (error) {
    console.error('[Auth] Failed to clear username backoff:', error);
  }
}
