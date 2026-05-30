import { NextRequest, NextResponse } from 'next/server';
import { isIP } from 'net';
import { getRedisClient } from '@/lib/redis';

// Shared IP-bucket rate limiting for the login endpoints (local password and
// "Sign in with Jellyfin"). Both routes funnel through the same Redis bucket so
// an attacker can't sidestep the cap by alternating endpoints.

const LOGIN_WINDOW_MS = 60_000;
const LOGIN_WINDOW_SECONDS = Math.max(1, Math.ceil(LOGIN_WINDOW_MS / 1000));
const LOGIN_MAX_ATTEMPTS = 5;
const LOGIN_ATTEMPTS_KEY_PREFIX = 'login:attempts:';

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
