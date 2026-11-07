import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireUserCapability: vi.fn(),
  findMany: vi.fn(),
  count: vi.fn(),
  create: vi.fn(),
  deleteMany: vi.fn(),
  recordSecurityEvent: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUser: mocks.requireUser,
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    calendarFeedToken: {
      findMany: mocks.findMany, count: mocks.count, create: mocks.create, deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));

import { GET, POST } from './route';
import { DELETE } from './[id]/route';
import { hashFeedToken, isWellFormedFeedToken, MAX_FEED_LINKS } from '@/lib/calendar-feed/token';

const USER = { id: 'u1', username: 'member' };
const signedIn = { ok: true, user: USER, session: { id: 's1' } };
const forbidden = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const unauthorized = { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

function post(body: unknown) {
  return POST(new NextRequest('http://localhost/api/calendar/feed-token', { method: 'POST', body: JSON.stringify(body) }));
}
function revoke(id: string) {
  return DELETE(new NextRequest(`http://localhost/api/calendar/feed-token/${id}`, { method: 'DELETE' }), { params: Promise.resolve({ id }) });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(signedIn);
  mocks.requireUserCapability.mockResolvedValue(signedIn);
  mocks.count.mockResolvedValue(0);
  mocks.create.mockResolvedValue({ id: 'link-1', createdAt: new Date('2026-11-08T00:00:00Z') });
});

describe('POST /api/calendar/feed-token', () => {
  it('makes a named link with its own filters, returns its token once and stores only the hash', async () => {
    const res = await post({ name: '  Kids movies ', filters: { type: 'movie', instanceId: 'rad-1', monitoredOnly: true } });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isWellFormedFeedToken(body.token)).toBe(true);
    expect(body).toMatchObject({ id: 'link-1', name: 'Kids movies', filters: { type: 'movie', instanceId: 'rad-1', monitoredOnly: true } });
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('calendar.view');

    const { data } = mocks.create.mock.calls[0][0];
    expect(data).toEqual({
      userId: 'u1', name: 'Kids movies', type: 'movie', instanceId: 'rad-1', monitoredOnly: true, tokenHash: hashFeedToken(body.token),
    });
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(body.token);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      action: 'CALENDAR_FEED_CREATED', targetId: 'u1',
    }));
  });

  it('makes a link that shows everything when no filters are sent', async () => {
    await post({ name: 'Everything' });
    expect(mocks.create.mock.calls[0][0].data).toMatchObject({ type: null, instanceId: null, monitoredOnly: false });
  });

  it.each([
    [{}, 'no name'],
    [{ name: '   ' }, 'a blank name'],
    [{ name: 'x'.repeat(61) }, 'a long name'],
    [{ name: 'a\nb' }, 'a control character'],
    [{ name: 'A', filters: { type: 'series' } }, 'an unknown type'],
    [{ name: 'A', filters: { instanceId: 'a b' } }, 'a malformed instance'],
    [{ name: 'A', filters: { monitoredOnly: 'yes' } }, 'a non-boolean monitored'],
    [{ name: 'A', filters: [] }, 'filters that are not an object'],
  ] as Array<[unknown, string]>)('refuses %j (%s) without making anything', async (body) => {
    expect((await post(body)).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it(`stops at ${MAX_FEED_LINKS} links`, async () => {
    mocks.count.mockResolvedValue(MAX_FEED_LINKS);
    expect((await post({ name: 'One more' })).status).toBe(409);
    expect(mocks.count).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('refuses a user without calendar.view', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden);
    expect((await post({ name: 'A' })).status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('answers 500 without auditing on a database error', async () => {
    mocks.create.mockRejectedValue(new Error('db down'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    expect((await post({ name: 'A' })).status).toBe(500);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/calendar/feed-token/[id]', () => {
  it('turns off only that link of the signed-in user, and audits it', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await revoke('link-2');
    expect(await res.json()).toEqual({ revoked: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { id: 'link-2', userId: 'u1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'CALENDAR_FEED_REVOKED' }));
  });

  it("answers 404 for someone else's or an unknown link, and records nothing", async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect((await revoke('theirs')).status).toBe(404);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    mocks.requireUser.mockResolvedValue(unauthorized);
    expect((await revoke('link-1')).status).toBe(401);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/calendar/feed-token', () => {
  it('lists the links with their names and filters, without any token material', async () => {
    mocks.findMany.mockResolvedValue([
      { id: 'a', name: 'Calendar', type: null, instanceId: null, monitoredOnly: false, createdAt: new Date('2026-11-01T00:00:00Z'), lastUsedAt: null },
      { id: 'b', name: 'Movies', type: 'movie', instanceId: null, monitoredOnly: true, createdAt: new Date('2026-11-02T00:00:00Z'), lastUsedAt: new Date('2026-11-03T00:00:00Z') },
    ]);
    const body = await (await GET()).json();
    expect(body).toEqual({
      links: [
        { id: 'a', name: 'Calendar', filters: { type: null, instanceId: null, monitoredOnly: false }, createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null },
        { id: 'b', name: 'Movies', filters: { type: 'movie', instanceId: null, monitoredOnly: true }, createdAt: '2026-11-02T00:00:00.000Z', lastUsedAt: '2026-11-03T00:00:00.000Z' },
      ],
      max: MAX_FEED_LINKS,
      origin: null,
    });
    const args = mocks.findMany.mock.calls[0][0];
    expect(args.where).toEqual({ userId: 'u1' });
    expect(args.select).not.toHaveProperty('tokenHash');
  });

  it('gives the configured APP_ORIGIN for the link, and null for a malformed one', async () => {
    mocks.findMany.mockResolvedValue([]);
    vi.stubEnv('APP_ORIGIN', ' https://helprr.example ');
    try {
      expect((await (await GET()).json()).origin).toBe('https://helprr.example');
      vi.stubEnv('APP_ORIGIN', 'https://helprr.example/path');
      expect((await (await GET()).json()).origin).toBeNull();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it('refuses a user without calendar.view', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden);
    expect((await GET()).status).toBe(403);
  });
});
