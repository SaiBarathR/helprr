import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { NextResponse, type NextRequest } from 'next/server';
import type { User } from '@prisma/client';
import { prisma } from '@/lib/db';
import type { Capability } from '@/lib/capabilities';
import { isApiTokenScope } from '@/lib/api-token-scopes';
import { getClientIp } from '@/lib/login-rate-limit';
import { can } from '@/lib/permissions';
import { getRedisClient } from '@/lib/redis';
import { coarseIp, recordSecurityEvent } from '@/lib/security-audit';

// Personal API tokens: `hlp_` and 32 random bytes (base64url), sent as
// `Authorization: Bearer hlp_…` to the read-only status API, and nowhere else
// (src/proxy.ts refuses one on any other path). Only the SHA-256 is stored (the
// token has full entropy, so a fast hash is enough). Every request re-reads the
// token and its owner: an expired token, or one whose owner is not active, is
// refused, and only the scopes the owner still holds are used.

export const API_TOKEN_PREFIX = 'hlp_';
const TOKEN_BYTES = 32;
const TOKEN_PATTERN = /^hlp_[A-Za-z0-9_-]{43}$/;
// The scheme is case-insensitive (RFC 9110); the token itself is exact.
const BEARER_PATTERN = /^Bearer[ ]+(\S+)$/i;
export const MAX_API_TOKENS = 10;
export const MAX_API_TOKEN_EXPIRY_DAYS = 365;

// Shortcuts, widgets and Home Assistant poll every few seconds at most; this
// leaves room for several of them sharing one token.
export const API_TOKEN_RATE_LIMIT_MAX = 300;
export const API_TOKEN_RATE_LIMIT_WINDOW_SECONDS = 5 * 60;
const RATE_LIMIT_KEY_PREFIX = 'api-token:rate:';
// Refused tokens per client IP (trusted proxy only, like sign-in). Past this a
// refused token gets 429 instead of 401 for the rest of the window; a live token
// from the same IP is never held back, so a stale widget cannot lock out a new
// token. Guessing a 256-bit token is hopeless anyway: this slows a client that
// keeps trying.
export const API_TOKEN_MISS_MAX = 30;
export const API_TOKEN_MISS_WINDOW_SECONDS = 15 * 60;
const MISS_KEY_PREFIX = 'api-token:misses:';
// INCR, starting the window on the first hit; returns the count and the time left.
const COUNT_SCRIPT = `local count = redis.call('INCR', KEYS[1])
if count == 1 then
  redis.call('EXPIRE', KEYS[1], ARGV[1])
end
local ttl = redis.call('TTL', KEYS[1])
return {tostring(count), tostring(ttl)}`;
// lastUsedAt is shown to the owner; a write per request is not needed for that.
const LAST_USED_DEBOUNCE_MS = 5 * 60 * 1000;
// Networks remembered per token; the oldest is dropped (and audited again if it returns).
const MAX_KNOWN_NETWORKS = 20;

export function generateApiToken(): string {
  return `${API_TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('base64url')}`;
}

export function hashApiToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/** The token in an Authorization header, when it is a well-formed `Bearer hlp_…`; null otherwise. */
export function bearerApiToken(header: string | null): string | null {
  const match = header ? BEARER_PATTERN.exec(header.trim()) : null;
  return match && TOKEN_PATTERN.test(match[1]) ? match[1] : null;
}

/** The scopes a token may be given now: the known ones its owner holds. */
export function grantableScopes(user: Pick<User, 'role' | 'template' | 'permissions'>, scopes: readonly string[]): Capability[] {
  return scopes.filter((scope): scope is Capability => isApiTokenScope(scope) && can(user, scope));
}

async function countHit(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
  const redis = await getRedisClient();
  const result = await redis.eval(COUNT_SCRIPT, { keys: [key], arguments: [String(windowSeconds)] });
  const values = Array.isArray(result) ? result : [];
  const count = Number(values[0]);
  if (!Number.isFinite(count)) throw new Error('Unexpected Redis result for API token rate limit');
  return { count, ttl: Number(values[1]) };
}

/** Seconds this IP must wait after too many refused tokens, 0 when it may try. Read-only. Throws when Redis is down. */
async function missRetryAfter(ip: string): Promise<number> {
  const redis = await getRedisClient();
  const key = `${MISS_KEY_PREFIX}${ip}`;
  const [raw, ttl] = await Promise.all([redis.get(key), redis.ttl(key)]);
  const misses = raw ? Number(raw) : 0;
  if (!Number.isFinite(misses) || misses < API_TOKEN_MISS_MAX) return 0;
  return ttl > 0 ? ttl : API_TOKEN_MISS_WINDOW_SECONDS;
}

async function recordMiss(ip: string): Promise<void> {
  try {
    await countHit(`${MISS_KEY_PREFIX}${ip}`, API_TOKEN_MISS_WINDOW_SECONDS);
  } catch (error) {
    console.error(`[ApiToken] Failed to record a refused token: ${error instanceof Error ? error.name : 'unknown error'}`);
  }
}

/** Seconds to wait when this token is over its limit, 0 when it may go ahead. Throws when Redis is down. */
async function takeRateLimit(tokenHash: string): Promise<number> {
  const { count, ttl } = await countHit(`${RATE_LIMIT_KEY_PREFIX}${tokenHash}`, API_TOKEN_RATE_LIMIT_WINDOW_SECONDS);
  if (count <= API_TOKEN_RATE_LIMIT_MAX) return 0;
  return Number.isFinite(ttl) && ttl > 0 ? ttl : API_TOKEN_RATE_LIMIT_WINDOW_SECONDS;
}

function json(body: object, status: number, headers: Record<string, string> = {}): NextResponse {
  return NextResponse.json(body, { status, headers: { 'Cache-Control': 'no-store', ...headers } });
}

const unauthorized = () => json({ error: 'Unauthorized' }, 401, { 'WWW-Authenticate': 'Bearer realm="helprr"' });
const unavailable = () => json({ error: 'Service unavailable' }, 503);

export type ApiTokenAuthResult =
  | { ok: true; user: User; tokenId: string; scopes: ReadonlySet<Capability> }
  | { ok: false; response: NextResponse };

/**
 * Authorize a status API request by its bearer token. Every refusal of the
 * token itself (missing, malformed, unknown, expired, owner not active) is the
 * same 401 and counts against the client IP, which past its cap gets 429
 * instead. A token none of whose scopes its owner still holds is a 403. Fails
 * closed (503) when Redis is down.
 */
export async function authorizeApiTokenRequest(request: NextRequest, now: Date = new Date()): Promise<ApiTokenAuthResult> {
  const ip = getClientIp(request);

  const refuse = async (): Promise<ApiTokenAuthResult> => {
    if (ip === undefined) return { ok: false, response: unauthorized() };
    let wait: number;
    try {
      wait = await missRetryAfter(ip);
    } catch {
      return { ok: false, response: unavailable() };
    }
    // Refusals while held back do not extend the window.
    if (wait > 0) return { ok: false, response: json({ error: 'Too many requests' }, 429, { 'Retry-After': String(wait) }) };
    await recordMiss(ip);
    return { ok: false, response: unauthorized() };
  };

  const token = bearerApiToken(request.headers.get('authorization'));
  if (!token) return refuse();
  const tokenHash = hashApiToken(token);
  const row = await prisma.apiToken.findUnique({ where: { tokenHash }, include: { user: true } });
  // The index lookup already matched the hash; the constant-time compare keeps
  // the final check independent of where two hashes differ.
  if (
    !row
    || !timingSafeEqual(Buffer.from(row.tokenHash, 'utf8'), Buffer.from(tokenHash, 'utf8'))
    || (row.expiresAt !== null && row.expiresAt.getTime() <= now.getTime())
    || row.user.status !== 'active'
  ) {
    return refuse();
  }

  // Only a live token gets a bucket, so random guesses cannot fill Redis with keys.
  let retryAfter: number;
  try {
    retryAfter = await takeRateLimit(tokenHash);
  } catch {
    return { ok: false, response: unavailable() };
  }
  if (retryAfter > 0) return { ok: false, response: json({ error: 'Too many requests' }, 429, { 'Retry-After': String(retryAfter) }) };

  await noteUse(request, row, ip, now);

  const scopes = new Set(grantableScopes(row.user, row.scopes));
  if (scopes.size === 0) return { ok: false, response: json({ error: 'Forbidden' }, 403) };
  return { ok: true, user: row.user, tokenId: row.id, scopes };
}

/**
 * Record when the token was last used and, the first time it is used from a
 * network, a security event. Keyed on the hash too, so a use never touches a
 * token made meanwhile with the same id. Fail-soft.
 */
async function noteUse(
  request: NextRequest,
  row: { id: string; tokenHash: string; name: string; usedFrom: string[]; lastUsedAt: Date | null; user: User },
  ip: string | undefined,
  now: Date,
): Promise<void> {
  const network = coarseIp(ip) ?? 'unknown';
  try {
    if (!row.usedFrom.includes(network)) {
      const updated = await prisma.apiToken.updateMany({
        where: { id: row.id, tokenHash: row.tokenHash, NOT: { usedFrom: { has: network } } },
        // An append, so two new networks at once both stay; trimmed only when full.
        data: {
          usedFrom: row.usedFrom.length < MAX_KNOWN_NETWORKS
            ? { push: network }
            : { set: [...row.usedFrom, network].slice(-MAX_KNOWN_NETWORKS) },
          lastUsedAt: now,
        },
      });
      // Of two requests from the same new network at once, only one records it.
      if (updated.count === 1) {
        await recordSecurityEvent(request, {
          actor: row.user,
          action: 'API_TOKEN_NEW_NETWORK',
          targetType: 'api-token',
          targetId: row.id,
          targetLabel: row.name,
        });
      }
      return;
    }
    if (!row.lastUsedAt || now.getTime() - row.lastUsedAt.getTime() > LAST_USED_DEBOUNCE_MS) {
      await prisma.apiToken.updateMany({ where: { id: row.id, tokenHash: row.tokenHash }, data: { lastUsedAt: now } });
    }
  } catch (error) {
    console.error(`[ApiToken] Failed to record use: ${error instanceof Error ? error.name : 'unknown error'}`);
  }
}
