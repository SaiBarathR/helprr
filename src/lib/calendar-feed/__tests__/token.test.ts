import { createHash } from 'crypto';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  updateMany: vi.fn(),
  evalScript: vi.fn(),
}));

vi.mock('@/lib/db', () => ({
  prisma: { calendarFeedToken: { findUnique: mocks.findUnique, updateMany: mocks.updateMany } },
}));
vi.mock('@/lib/redis', () => ({
  getRedisClient: async () => ({ eval: mocks.evalScript }),
}));

import {
  FEED_RATE_LIMIT_MAX,
  FEED_RATE_LIMIT_WINDOW_SECONDS,
  authorizeFeedToken,
  generateFeedToken,
  hashFeedToken,
  isWellFormedFeedToken,
  takeFeedRateLimit,
} from '@/lib/calendar-feed/token';

const NOW = new Date('2026-11-07T10:00:00Z');

function row(user: Record<string, unknown> = {}, lastUsedAt: Date | null = null) {
  return {
    id: 'feed-1',
    tokenHash: 'h',
    lastUsedAt,
    user: { id: 'u1', username: 'member', role: 'member', template: 'member', permissions: {}, status: 'active', ...user },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.updateMany.mockResolvedValue({ count: 1 });
});

describe('feed tokens', () => {
  it('are 256-bit, URL-safe and distinct', () => {
    const a = generateFeedToken();
    const b = generateFeedToken();
    expect(a).not.toBe(b);
    expect(Buffer.from(a, 'base64url')).toHaveLength(32);
    expect(isWellFormedFeedToken(a)).toBe(true);
  });

  it('are stored as their SHA-256 only', () => {
    const token = generateFeedToken();
    const hash = hashFeedToken(token);
    expect(hash).toBe(createHash('sha256').update(token).digest('hex'));
    expect(hash).not.toContain(token);
  });

  it.each([null, '', 'short', `${'a'.repeat(43)}=`, `${'a'.repeat(42)}!`, 'a'.repeat(44)])('reject the malformed %j', (token) => {
    expect(isWellFormedFeedToken(token)).toBe(false);
  });
});

describe('authorizeFeedToken', () => {
  it('refuses an unknown (revoked or rotated) token', async () => {
    mocks.findUnique.mockResolvedValue(null);
    await expect(authorizeFeedToken('h', NOW)).resolves.toBeNull();
    expect(mocks.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: 'h' } }));
  });

  it.each(['disabled', 'pending'])('refuses a %s owner', async (status) => {
    mocks.findUnique.mockResolvedValue(row({ status }));
    await expect(authorizeFeedToken('h', NOW)).resolves.toBeNull();
  });

  it('re-checks calendar.view on every fetch', async () => {
    mocks.findUnique.mockResolvedValue(row({ permissions: { 'calendar.view': false } }));
    await expect(authorizeFeedToken('h', NOW)).resolves.toBeNull();
    // A member template without the capability is refused too.
    mocks.findUnique.mockResolvedValue(row({ template: 'member', permissions: { 'calendar.view': false }, role: 'member' }));
    await expect(authorizeFeedToken('h', NOW)).resolves.toBeNull();
  });

  it('lets an admin whose overrides deny it through, as can() does', async () => {
    mocks.findUnique.mockResolvedValue(row({ role: 'admin', template: 'admin', permissions: { 'calendar.view': false } }));
    await expect(authorizeFeedToken('h', NOW)).resolves.toMatchObject({ id: 'u1' });
  });

  it('returns an active capable owner and records the use, at most every few minutes', async () => {
    mocks.findUnique.mockResolvedValue(row());
    await expect(authorizeFeedToken('h', NOW)).resolves.toMatchObject({ id: 'u1' });
    expect(mocks.updateMany).toHaveBeenCalledWith({ where: { id: 'feed-1', tokenHash: 'h' }, data: { lastUsedAt: NOW } });

    mocks.updateMany.mockClear();
    mocks.findUnique.mockResolvedValue(row({}, new Date(NOW.getTime() - 60_000)));
    await authorizeFeedToken('h', NOW);
    expect(mocks.updateMany).not.toHaveBeenCalled();
  });
});

describe('takeFeedRateLimit', () => {
  it('lets fetches under the limit through, keyed by the token hash', async () => {
    mocks.evalScript.mockResolvedValue(['1', String(FEED_RATE_LIMIT_WINDOW_SECONDS)]);
    await expect(takeFeedRateLimit('abc')).resolves.toBe(0);
    expect(mocks.evalScript.mock.calls[0][1]).toMatchObject({ keys: ['calendar-feed:rate:abc'] });
  });

  it('returns the wait once over the limit', async () => {
    mocks.evalScript.mockResolvedValue([String(FEED_RATE_LIMIT_MAX + 1), '120']);
    await expect(takeFeedRateLimit('abc')).resolves.toBe(120);
  });

  it('throws on an unreadable Redis answer, so the route fails closed', async () => {
    mocks.evalScript.mockResolvedValue(null);
    await expect(takeFeedRateLimit('abc')).rejects.toThrow();
  });
});
