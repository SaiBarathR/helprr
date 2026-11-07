import { createHash, randomBytes } from 'crypto';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import { storedFeedFilters, type FeedFilters } from '@/lib/calendar-feed/filters';
import { can } from '@/lib/permissions';
import { getRedisClient } from '@/lib/redis';

// The calendar feed's credential: a per-user, read-only, revocable token that a
// calendar app sends as ?token=. It is 32 random bytes; only its SHA-256 is
// stored (the token has full entropy, so a fast hash is enough). It grants
// calendar.view and nothing else, and the owner's current status, role and
// capabilities are re-read on every fetch.

const TOKEN_BYTES = 32;
// Named links per user (one per calendar app or filter set is plenty).
export const MAX_FEED_LINKS = 10;
// base64url of 32 bytes, no padding.
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

// Calendar apps poll every few minutes at most; this leaves room for several
// devices sharing one link and a person refreshing by hand.
export const FEED_RATE_LIMIT_MAX = 30;
export const FEED_RATE_LIMIT_WINDOW_SECONDS = 15 * 60;
const RATE_LIMIT_KEY_PREFIX = 'calendar-feed:rate:';
// Fetches with a well-formed token that opens no feed, per client IP (trusted
// proxy only, like sign-in). A revoked link still polled by a few calendar apps
// stays far below this; a client guessing tokens is held at 429 for the window.
export const FEED_MISS_MAX = 30;
export const FEED_MISS_WINDOW_SECONDS = 15 * 60;
const MISS_KEY_PREFIX = 'calendar-feed:misses:';
// INCR, starting the window on the first hit; returns the count and the time left.
const COUNT_SCRIPT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {tostring(count), tostring(ttl)}`;
// lastUsedAt is shown to the owner; a write per fetch is not needed for that.
const LAST_USED_DEBOUNCE_MS = 10 * 60 * 1000;

export function generateFeedToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashFeedToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function isWellFormedFeedToken(token: string | null): token is string {
  return typeof token === 'string' && TOKEN_PATTERN.test(token);
}

/**
 * Count one fetch against the token's bucket. Returns the seconds to wait when
 * over the limit, 0 when the fetch may go ahead. Throws when Redis is
 * unreachable, so the caller can fail closed.
 */
export async function takeFeedRateLimit(tokenHash: string): Promise<number> {
  const redis = await getRedisClient();
  const result = await redis.eval(COUNT_SCRIPT, {
    keys: [`${RATE_LIMIT_KEY_PREFIX}${tokenHash}`],
    arguments: [String(FEED_RATE_LIMIT_WINDOW_SECONDS)],
  });
  const values = Array.isArray(result) ? result : [];
  const count = Number(values[0]);
  const ttl = Number(values[1]);
  if (!Number.isFinite(count)) throw new Error('Unexpected Redis result for calendar feed rate limit');
  if (count <= FEED_RATE_LIMIT_MAX) return 0;
  return Number.isFinite(ttl) && ttl > 0 ? ttl : FEED_RATE_LIMIT_WINDOW_SECONDS;
}

/**
 * Seconds this client IP must wait after too many fetches that opened no feed,
 * 0 when it may try. Read-only, so retrying while refused does not extend the
 * window. Throws when Redis is unreachable, so the caller can fail closed.
 */
export async function feedMissRetryAfter(ip: string): Promise<number> {
  const redis = await getRedisClient();
  const key = `${MISS_KEY_PREFIX}${ip}`;
  const [raw, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  const misses = raw ? Number(raw) : 0;
  if (!Number.isFinite(misses) || misses < FEED_MISS_MAX) return 0;
  return ttl > 0 ? ttl : FEED_MISS_WINDOW_SECONDS;
}

/** Count one fetch that opened no feed against its client IP. Best-effort: a Redis error is logged, not surfaced. */
export async function recordFeedMiss(ip: string): Promise<void> {
  try {
    const redis = await getRedisClient();
    await redis.eval(COUNT_SCRIPT, { keys: [`${MISS_KEY_PREFIX}${ip}`], arguments: [String(FEED_MISS_WINDOW_SECONDS)] });
  } catch (error) {
    console.error(`[CalendarFeed] Failed to record a miss: ${error instanceof Error ? error.name : 'unknown error'}`);
  }
}

/**
 * The user a feed token belongs to and the link's own filters, when the token is
 * current (not revoked) and its owner is active and may still view the calendar;
 * null otherwise. Callers answer every null the same way, so a response never
 * says which check failed.
 */
export async function authorizeFeedToken(
  tokenHash: string,
  now: Date = new Date(),
): Promise<{ user: User; name: string; filters: FeedFilters } | null> {
  const row = await prisma.calendarFeedToken.findUnique({
    where: { tokenHash },
    include: { user: true },
  });
  if (!row || row.user.status !== 'active' || !can(row.user, 'calendar.view')) return null;
  const filters = storedFeedFilters(row);
  if (!filters) return null;

  if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_DEBOUNCE_MS) {
    // Keyed on the hash too, so a fetch never touches another link.
    prisma.calendarFeedToken
      .updateMany({ where: { id: row.id, tokenHash }, data: { lastUsedAt: now } })
      .catch((error: unknown) => {
        console.error(`[CalendarFeed] Failed to record last use: ${error instanceof Error ? error.name : 'unknown error'}`);
      });
  }
  return { user: row.user, name: row.name, filters };
}
