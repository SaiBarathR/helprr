import { createHash } from 'crypto';
import { NextRequest } from 'next/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  evalScript: vi.fn(),
  redisGet: vi.fn(),
  redisTtl: vi.fn(),
  getRedisClient: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { apiToken: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/redis', () => ({ getRedisClient: mocks.getRedisClient }));
vi.mock('@/lib/security-audit', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/security-audit')>()),
  recordSecurityEvent: mocks.recordSecurityEvent,
}));

import {
  API_TOKEN_MISS_MAX,
  API_TOKEN_RATE_LIMIT_MAX,
  authorizeApiTokenRequest,
  bearerApiToken,
  generateApiToken,
  grantableScopes,
  hashApiToken,
} from '@/lib/api-tokens';

const NOW = new Date('2026-11-07T10:00:00Z');
const TOKEN = generateApiToken();
// Members make tokens only when api.tokens is turned on for them.
const MEMBER = { id: 'u1', username: 'member', role: 'member', template: 'member', permissions: { 'api.tokens': true }, status: 'active' };

function row(overrides: Record<string, unknown> = {}, user: Record<string, unknown> = {}) {
  return {
    id: 'tok-1',
    userId: 'u1',
    name: 'Shortcuts',
    tokenHash: hashApiToken(TOKEN),
    scopes: ['activity.view', 'calendar.view'],
    expiresAt: null,
    createdAt: new Date('2026-11-01T00:00:00Z'),
    lastUsedAt: null,
    usedFrom: ['203.0.113.0/24'],
    user: { ...MEMBER, ...user, permissions: { ...MEMBER.permissions, ...(user.permissions as object | undefined) } },
    ...overrides,
  };
}

function request(authorization: string | null = `Bearer ${TOKEN}`, ip = '203.0.113.7') {
  const headers: Record<string, string> = { 'x-forwarded-for': ip };
  if (authorization !== null) headers.authorization = authorization;
  return new NextRequest('http://localhost/api/v1/summary', { headers });
}

const originalTrust = process.env.TRUST_FORWARDED_PROTO;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.TRUST_FORWARDED_PROTO = 'true';
  mocks.updateMany.mockResolvedValue({ count: 1 });
  mocks.evalScript.mockResolvedValue(['1', '300']);
  mocks.redisGet.mockResolvedValue(null);
  mocks.redisTtl.mockResolvedValue(-2);
  mocks.getRedisClient.mockResolvedValue({ eval: mocks.evalScript, get: mocks.redisGet, ttl: mocks.redisTtl });
});

afterEach(() => {
  if (originalTrust === undefined) delete process.env.TRUST_FORWARDED_PROTO;
  else process.env.TRUST_FORWARDED_PROTO = originalTrust;
});

describe('API tokens', () => {
  it('are hlp_ and 256 random bits, distinct, and stored as their SHA-256 only', () => {
    const other = generateApiToken();
    expect(TOKEN).toMatch(/^hlp_[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(TOKEN.slice(4), 'base64url')).toHaveLength(32);
    expect(other).not.toBe(TOKEN);
    expect(hashApiToken(TOKEN)).toBe(createHash('sha256').update(TOKEN).digest('hex'));
    expect(hashApiToken(TOKEN)).not.toContain(TOKEN.slice(4));
  });

  it('are read only from a well-formed Bearer header', () => {
    expect(bearerApiToken(`Bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerApiToken(`bearer ${TOKEN}`)).toBe(TOKEN);
    expect(bearerApiToken(TOKEN)).toBeNull();
    expect(bearerApiToken(`Basic ${TOKEN}`)).toBeNull();
    expect(bearerApiToken(`Bearer ${TOKEN}x`)).toBeNull();
    expect(bearerApiToken(`Bearer ${TOKEN} extra`)).toBeNull();
    expect(bearerApiToken('Bearer hlp_short')).toBeNull();
    expect(bearerApiToken(null)).toBeNull();
  });

  it('can only be given known scopes the owner holds', () => {
    const member = { role: 'member' as const, template: 'member' as const, permissions: { 'jellyfin.sessions': false } };
    expect(grantableScopes(member, ['activity.view', 'jellyfin.sessions', 'torrents.delete', 'nonsense'])).toEqual(['activity.view']);
    const admin = { role: 'admin' as const, template: 'admin' as const, permissions: {} };
    // Even an admin cannot give a token a write capability.
    expect(grantableScopes(admin, ['torrents.delete', 'activity.manage', 'activity.view'])).toEqual(['activity.view']);
  });
});

describe('authorizeApiTokenRequest', () => {
  it('opens with a live token and only the scopes its owner still holds', async () => {
    // calendar.view taken away after the token was made.
    mocks.findUnique.mockResolvedValue(row({}, { permissions: { 'calendar.view': false } }));
    const auth = await authorizeApiTokenRequest(request(), NOW);
    expect(auth.ok).toBe(true);
    if (!auth.ok) return;
    expect([...auth.scopes]).toEqual(['activity.view']);
    expect(auth.user.id).toBe('u1');
    expect(mocks.findUnique).toHaveBeenCalledWith({ where: { tokenHash: hashApiToken(TOKEN) }, include: { user: true } });
  });

  it('is a 403 when the owner holds none of its scopes any more', async () => {
    mocks.findUnique.mockResolvedValue(row({}, { permissions: { 'calendar.view': false, 'activity.view': false } }));
    const auth = await authorizeApiTokenRequest(request(), NOW);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(403);
  });

  it('is a 403 once the owner may no longer make API tokens, checked on every request, and not counted as a use', async () => {
    mocks.findUnique.mockResolvedValue(row({}, { permissions: { 'api.tokens': false } }));
    const auth = await authorizeApiTokenRequest(request(`Bearer ${TOKEN}`, '198.51.100.9'), NOW);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(403);
    expect(mocks.updateMany).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('opens for an admin, who holds api.tokens by default', async () => {
    mocks.findUnique.mockResolvedValue(row({}, { role: 'admin', template: 'admin', permissions: {} }));
    expect((await authorizeApiTokenRequest(request(), NOW)).ok).toBe(true);
  });

  it.each([
    ['no header', null, () => row()],
    ['a malformed token', 'Bearer hlp_nope', () => row()],
    ['another scheme', `Basic ${TOKEN}`, () => row()],
    ['an unknown or revoked token', `Bearer ${TOKEN}`, () => null],
    ['an expired token', `Bearer ${TOKEN}`, () => row({ expiresAt: new Date(NOW.getTime() - 1) })],
    ['a disabled owner', `Bearer ${TOKEN}`, () => row({}, { status: 'disabled' })],
    ['a pending owner', `Bearer ${TOKEN}`, () => row({}, { status: 'pending' })],
  ])('refuses %s with the same 401, counted against the IP', async (_label, header, found) => {
    mocks.findUnique.mockResolvedValue(found());
    const auth = await authorizeApiTokenRequest(request(header), NOW);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(401);
    expect(auth.response.headers.get('www-authenticate')).toBe('Bearer realm="helprr"');
    expect(await auth.response.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.evalScript).toHaveBeenCalledWith(expect.any(String), {
      keys: ['api-token:misses:203.0.113.7'],
      arguments: [String(15 * 60)],
    });
    // A refused token never gets a rate-limit bucket or a use recorded.
    expect(mocks.evalScript).toHaveBeenCalledTimes(1);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('accepts a token until the moment it expires', async () => {
    mocks.findUnique.mockResolvedValue(row({ expiresAt: new Date(NOW.getTime() + 1000) }));
    expect((await authorizeApiTokenRequest(request(), NOW)).ok).toBe(true);
  });

  it('holds an IP with too many refused tokens at 429, without extending its window', async () => {
    mocks.redisGet.mockResolvedValue(String(API_TOKEN_MISS_MAX));
    mocks.redisTtl.mockResolvedValue(120);
    mocks.findUnique.mockResolvedValue(null);
    const auth = await authorizeApiTokenRequest(request(), NOW);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(429);
    expect(auth.response.headers.get('retry-after')).toBe('120');
    expect(mocks.evalScript).not.toHaveBeenCalled();
  });

  it('never holds back a live token from an IP over its cap, so a stale widget cannot lock out a new token', async () => {
    mocks.redisGet.mockResolvedValue(String(API_TOKEN_MISS_MAX + 50));
    mocks.redisTtl.mockResolvedValue(120);
    mocks.findUnique.mockResolvedValue(row());
    expect((await authorizeApiTokenRequest(request(), NOW)).ok).toBe(true);
    expect(mocks.redisGet).not.toHaveBeenCalled();
  });

  it('limits each live token on its own', async () => {
    mocks.findUnique.mockResolvedValue(row());
    mocks.evalScript.mockResolvedValue([String(API_TOKEN_RATE_LIMIT_MAX + 1), '42']);
    const auth = await authorizeApiTokenRequest(request(), NOW);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(429);
    expect(auth.response.headers.get('retry-after')).toBe('42');
    expect(mocks.evalScript).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      keys: [`api-token:rate:${hashApiToken(TOKEN)}`],
    }));
  });

  it.each([
    ['a live token', () => row(), true],
    ['a refused token', () => null, true],
    ['a live token without a trusted proxy', () => row(), false],
  ])('fails closed when Redis is down, for %s', async (_label, found, trusted) => {
    if (!trusted) delete process.env.TRUST_FORWARDED_PROTO;
    mocks.getRedisClient.mockRejectedValue(new Error('down'));
    mocks.findUnique.mockResolvedValue(found());
    const auth = await authorizeApiTokenRequest(request(), NOW);
    expect(auth.ok).toBe(false);
    if (auth.ok) return;
    expect(auth.response.status).toBe(503);
  });

  it('records the first use from a new network once, and not again from a known one', async () => {
    mocks.findUnique.mockResolvedValue(row());
    await authorizeApiTokenRequest(request(`Bearer ${TOKEN}`, '198.51.100.9'), NOW);
    expect(mocks.updateMany).toHaveBeenCalledWith({
      where: { id: 'tok-1', tokenHash: hashApiToken(TOKEN), NOT: { usedFrom: { has: '198.51.100.0/24' } } },
      // An append, so a second new network at the same moment is kept too.
      data: { usedFrom: { push: '198.51.100.0/24' }, lastUsedAt: NOW },
    });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledTimes(1);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.any(NextRequest), expect.objectContaining({
      action: 'API_TOKEN_NEW_NETWORK',
      actor: expect.objectContaining({ id: 'u1' }),
      targetType: 'api-token',
      targetId: 'tok-1',
      targetLabel: 'Shortcuts',
    }));

    // Another request from that network raced it and recorded it first.
    vi.clearAllMocks();
    mocks.getRedisClient.mockResolvedValue({ eval: mocks.evalScript, get: mocks.redisGet, ttl: mocks.redisTtl });
    mocks.evalScript.mockResolvedValue(['1', '300']);
    mocks.findUnique.mockResolvedValue(row());
    mocks.updateMany.mockResolvedValue({ count: 0 });
    await authorizeApiTokenRequest(request(`Bearer ${TOKEN}`, '198.51.100.9'), NOW);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();

    // A known network: last use only, debounced.
    vi.clearAllMocks();
    mocks.getRedisClient.mockResolvedValue({ eval: mocks.evalScript, get: mocks.redisGet, ttl: mocks.redisTtl });
    mocks.evalScript.mockResolvedValue(['1', '300']);
    mocks.findUnique.mockResolvedValue(row({ lastUsedAt: new Date(NOW.getTime() - 60_000) }));
    await authorizeApiTokenRequest(request(), NOW);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });

  it('keeps the last 20 networks, dropping the oldest', async () => {
    const full = Array.from({ length: 20 }, (_, i) => `10.0.${i}.0/24`);
    mocks.findUnique.mockResolvedValue(row({ usedFrom: full }));
    await authorizeApiTokenRequest(request(`Bearer ${TOKEN}`, '198.51.100.9'), NOW);
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { usedFrom: { set: [...full.slice(1), '198.51.100.0/24'] }, lastUsedAt: NOW },
    }));
  });

  it('remembers a use without a trusted proxy as one "unknown" network, and skips the IP limit', async () => {
    delete process.env.TRUST_FORWARDED_PROTO;
    mocks.findUnique.mockResolvedValue(row({ usedFrom: [] }));
    expect((await authorizeApiTokenRequest(request(), NOW)).ok).toBe(true);
    expect(mocks.redisGet).not.toHaveBeenCalled();
    expect(mocks.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: { usedFrom: { push: 'unknown' }, lastUsedAt: NOW },
    }));
    expect(mocks.recordSecurityEvent).toHaveBeenCalledTimes(1);
  });
});
