import { NextResponse } from 'next/server';
import { getRedisClient } from '@/lib/redis';

// Throttles for the public invite routes (/api/invite/state and /accept). They
// mirror the sign-in layers in login-rate-limit.ts but use their own Redis keys,
// so a flood of junk links browns out only the invite page, never sign-in:
//   1. Per-IP bucket: every request, 10/min per trusted client IP (skipped
//      without a trusted proxy, like the sign-in bucket).
//   2. Global failed-attempt backstop: every unusable link or malformed body
//      counts; at the cap the invite routes refuse everything until the window
//      ends. Only failures advance it, so opening a working link cannot trip it.
// Both fail closed with a 503 when Redis is unreachable.

const IP_WINDOW_MS = 60_000;
const IP_MAX_ATTEMPTS = 10;
const IP_KEY_PREFIX = 'invite:attempts:';

const FAILURE_WINDOW_MS = 15 * 60_000;
const FAILURE_MAX = 30;
export const INVITE_FAILURES_KEY = 'invite:failures:global';

// INCR, starting the window on the first hit; returns the count and the time left.
const COUNT_SCRIPT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
end
return {tostring(count), tostring(redis.call('PTTL', KEYS[1]))}`;

function unavailable(): NextResponse {
  return NextResponse.json({ error: 'Helprr cannot check links right now. Try again shortly.' }, { status: 503 });
}

function tooMany(retryMs: number): NextResponse {
  const seconds = Math.max(1, Math.ceil(retryMs / 1000));
  const minutes = Math.ceil(seconds / 60);
  return NextResponse.json(
    { error: `Too many attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.` },
    { status: 429, headers: { 'Retry-After': String(seconds) } },
  );
}

async function count(key: string, windowMs: number): Promise<{ count: number; ttl: number }> {
  const redis = await getRedisClient();
  const result = await redis.eval(COUNT_SCRIPT, { keys: [key], arguments: [String(windowMs)] });
  const values = Array.isArray(result) ? result : [];
  const counted = Number(values[0]);
  if (!Number.isFinite(counted)) throw new Error('Unexpected Redis result for invite attempts');
  const ttl = Number(values[1]);
  return { count: counted, ttl: Number.isFinite(ttl) && ttl > 0 ? ttl : windowMs };
}

/** Count this request against its client IP; a 429 over the cap, null to go on. */
export async function enforceInviteRateLimit(ip: string | undefined): Promise<NextResponse | null> {
  if (ip === undefined) return null;
  try {
    const { count: attempts, ttl } = await count(`${IP_KEY_PREFIX}${ip}`, IP_WINDOW_MS);
    return attempts > IP_MAX_ATTEMPTS ? tooMany(ttl) : null;
  } catch {
    return unavailable();
  }
}

/** A 429 while the invite failure count is at the cap. Read-only, so retrying while refused does not extend it. */
export async function enforceInviteFailureBackstop(): Promise<NextResponse | null> {
  try {
    const redis = await getRedisClient();
    const [raw, pttl] = await Promise.all([redis.get(INVITE_FAILURES_KEY), redis.pTTL(INVITE_FAILURES_KEY)]);
    const failures = raw ? Number(raw) : 0;
    if (Number.isFinite(failures) && failures >= FAILURE_MAX) {
      return tooMany(typeof pttl === 'number' && pttl > 0 ? pttl : FAILURE_WINDOW_MS);
    }
    return null;
  } catch {
    return unavailable();
  }
}

/** Count one failed invite request. Best-effort: a Redis error is logged, not surfaced. */
export async function recordInviteFailure(): Promise<void> {
  try {
    await count(INVITE_FAILURES_KEY, FAILURE_WINDOW_MS);
  } catch (error) {
    console.error('[Invite] Failed to record a failed link attempt:', error instanceof Error ? error.name : 'unknown error');
  }
}
