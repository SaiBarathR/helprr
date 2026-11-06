import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  requireUserCapability: vi.fn(),
  findUnique: vi.fn(),
  create: vi.fn(),
  upsert: vi.fn(),
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
      findUnique: mocks.findUnique, create: mocks.create, upsert: mocks.upsert, deleteMany: mocks.deleteMany,
    },
  },
}));
vi.mock('@/lib/security-audit', () => ({ recordSecurityEvent: mocks.recordSecurityEvent }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));

import { DELETE, GET, POST } from './route';
import { hashFeedToken, isWellFormedFeedToken } from '@/lib/calendar-feed/token';

const USER = { id: 'u1', username: 'member' };
const signedIn = { ok: true, user: USER, session: { id: 's1' } };
const forbidden = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const unauthorized = { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };

function request(method: string) {
  return new NextRequest('http://localhost/api/calendar/feed-token', { method });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUser.mockResolvedValue(signedIn);
  mocks.requireUserCapability.mockResolvedValue(signedIn);
  mocks.create.mockResolvedValue({});
  mocks.upsert.mockResolvedValue({});
});

const uniqueViolation = Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });

describe('POST /api/calendar/feed-token', () => {
  it('returns a new token once and stores only its hash', async () => {
    const res = await POST(request('POST'));
    expect(res.status).toBe(200);
    const { token } = await res.json();
    expect(isWellFormedFeedToken(token)).toBe(true);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('calendar.view');

    const args = mocks.create.mock.calls[0][0];
    expect(args.data).toMatchObject({ userId: 'u1', tokenHash: hashFeedToken(token) });
    expect(mocks.upsert).not.toHaveBeenCalled();
    expect(JSON.stringify(mocks.create.mock.calls)).not.toContain(token);
    expect(JSON.stringify(mocks.recordSecurityEvent.mock.calls)).not.toContain(token);
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      actor: USER, action: 'CALENDAR_FEED_CREATED', targetType: 'user', targetId: 'u1',
    }));
  });

  it('replaces an existing token (so the old link stops working) and audits a rotation', async () => {
    mocks.create.mockRejectedValue(uniqueViolation);
    const first = await (await POST(request('POST'))).json();
    const second = await (await POST(request('POST'))).json();
    expect(first.token).not.toBe(second.token);
    expect(mocks.upsert.mock.calls[1][0].where).toEqual({ userId: 'u1' });
    expect(mocks.upsert.mock.calls[1][0].update).toMatchObject({ tokenHash: hashFeedToken(second.token), lastUsedAt: null });
    expect(JSON.stringify(mocks.upsert.mock.calls)).not.toContain(second.token);
    expect(mocks.recordSecurityEvent).toHaveBeenLastCalledWith(expect.anything(), expect.objectContaining({ action: 'CALENDAR_FEED_ROTATED' }));
  });

  it('refuses a user without calendar.view', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden);
    const res = await POST(request('POST'));
    expect(res.status).toBe(403);
    expect(mocks.create).not.toHaveBeenCalled();
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('answers 500 without auditing on another database error', async () => {
    mocks.create.mockRejectedValue(Object.assign(new Error('boom'), { code: 'P1001' }));
    expect((await POST(request('POST'))).status).toBe(500);
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/calendar/feed-token', () => {
  it('removes only the signed-in user’s token and audits it', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 1 });
    const res = await DELETE(request('DELETE'));
    expect(await res.json()).toEqual({ revoked: true });
    expect(mocks.deleteMany).toHaveBeenCalledWith({ where: { userId: 'u1' } });
    expect(mocks.recordSecurityEvent).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ action: 'CALENDAR_FEED_REVOKED' }));
  });

  it('records nothing when there was no token', async () => {
    mocks.deleteMany.mockResolvedValue({ count: 0 });
    expect(await (await DELETE(request('DELETE'))).json()).toEqual({ revoked: false });
    expect(mocks.recordSecurityEvent).not.toHaveBeenCalled();
  });

  it('needs a session', async () => {
    mocks.requireUser.mockResolvedValue(unauthorized);
    expect((await DELETE(request('DELETE'))).status).toBe(401);
    expect(mocks.deleteMany).not.toHaveBeenCalled();
  });
});

describe('GET /api/calendar/feed-token', () => {
  it('says whether a link is on, without any token material', async () => {
    mocks.findUnique.mockResolvedValue({ createdAt: new Date('2026-11-01T00:00:00Z'), lastUsedAt: null });
    const body = await (await GET()).json();
    expect(body).toEqual({ active: true, createdAt: '2026-11-01T00:00:00.000Z', lastUsedAt: null, origin: null });
    expect(mocks.findUnique.mock.calls[0][0].select).toEqual({ createdAt: true, lastUsedAt: true });
  });

  it('gives the configured APP_ORIGIN for the link, and null for a malformed one', async () => {
    mocks.findUnique.mockResolvedValue(null);
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
