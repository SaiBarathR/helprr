import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  userFindMany: vi.fn(),
  sessionFindMany: vi.fn(),
  sessionCount: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  SESSION_DURATION: 30 * 24 * 60 * 60,
  requireUser: mocks.requireUser,
}));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: { findMany: mocks.userFindMany },
    session: { findMany: mocks.sessionFindMany, count: mocks.sessionCount },
  },
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from './route';
import { SESSION_IDLE_TIMEOUT_SECONDS } from '@/lib/session-policy';

const NOW = new Date('2026-11-06T12:00:00Z').getTime();

const CURRENT = {
  id: 'current',
  createdAt: new Date('2026-11-01T00:00:00Z'),
  lastSeenAt: new Date(NOW),
  userAgent: 'iPhone',
  ip: '10.0.0.2',
  label: null,
};

function row(id: string) {
  return { ...CURRENT, id, userAgent: null, ip: null };
}

function auth(role: 'admin' | 'member') {
  return { ok: true, user: { id: 'me', role }, session: { ...CURRENT, revokedAt: null, userId: 'me' } };
}

function get(query = '') {
  return (GET as unknown as (req: NextRequest) => Promise<Response>)(
    new NextRequest(`http://localhost/api/sessions${query}`),
  );
}

const ACTIVE = {
  revokedAt: null,
  createdAt: { gte: new Date(NOW - 30 * 24 * 60 * 60 * 1000) },
  lastSeenAt: { gte: new Date(NOW - SESSION_IDLE_TIMEOUT_SECONDS * 1000) },
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(NOW);
  mocks.sessionFindMany.mockResolvedValue([]);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('GET /api/sessions', () => {
  it('shows a member only their own sessions, this device first', async () => {
    mocks.requireUser.mockResolvedValue(auth('member'));
    mocks.userFindMany.mockResolvedValue([{ id: 'me', displayName: 'Me', _count: { sessions: 3 } }]);
    mocks.sessionFindMany.mockResolvedValue([row('b'), row('a')]);

    const body = await (await get()).json();

    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'me' } }));
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...ACTIVE, userId: 'me', NOT: { id: 'current' } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip: 0,
      take: 9,
    }));
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({ userId: 'me', isOwn: true, total: 3, hasMore: false });
    expect(body.groups[0].sessions.map((s: { id: string }) => s.id)).toEqual(['current', 'b', 'a']);
    expect(body.groups[0].sessions[0].isCurrent).toBe(true);
  });

  it("refuses a member paging someone else's sessions", async () => {
    mocks.requireUser.mockResolvedValue(auth('member'));

    const response = await get('?userId=someone-else&skip=10');

    expect(response.status).toBe(404);
    expect(mocks.sessionFindMany).not.toHaveBeenCalled();
    expect(mocks.sessionCount).not.toHaveBeenCalled();
  });

  it('groups an admin view by person, own group first, one page each', async () => {
    mocks.requireUser.mockResolvedValue(auth('admin'));
    mocks.userFindMany.mockResolvedValue([
      { id: 'zed', displayName: 'Zed', _count: { sessions: 2 } },
      { id: 'amy', displayName: 'Amy', _count: { sessions: 25 } },
      { id: 'me', displayName: 'Admin', _count: { sessions: 1 } },
    ]);
    mocks.sessionFindMany.mockImplementation(async ({ where, take }: { where: { userId: string }; take: number }) =>
      Array.from({ length: Math.min(take, where.userId === 'amy' ? 25 : where.userId === 'zed' ? 2 : 0) }, (_, i) =>
        row(`${where.userId}-${i}`)
      ),
    );

    const body = await (await get()).json();

    expect(mocks.userFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { sessions: { some: ACTIVE } },
    }));
    expect(body.groups.map((g: { userId: string }) => g.userId)).toEqual(['me', 'amy', 'zed']);
    const [own, amy, zed] = body.groups;
    expect(own).toMatchObject({ isOwn: true, total: 1, hasMore: false });
    expect(own.sessions.map((s: { id: string }) => s.id)).toEqual(['current']);
    expect(amy).toMatchObject({ isOwn: false, ownerName: 'Amy', total: 25, hasMore: true });
    expect(amy.sessions).toHaveLength(10);
    expect(amy.sessions.every((s: { isCurrent: boolean }) => !s.isCurrent)).toBe(true);
    expect(zed).toMatchObject({ total: 2, hasMore: false });
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...ACTIVE, userId: 'amy' },
      skip: 0,
      take: 10,
    }));
  });

  it("pages another person's sessions for an admin", async () => {
    mocks.requireUser.mockResolvedValue(auth('admin'));
    mocks.sessionCount.mockResolvedValue(25);
    mocks.sessionFindMany.mockResolvedValue(Array.from({ length: 10 }, (_, i) => row(`amy-${10 + i}`)));

    const body = await (await get('?userId=amy&skip=10')).json();

    expect(mocks.sessionCount).toHaveBeenCalledWith({ where: { ...ACTIVE, userId: 'amy' } });
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...ACTIVE, userId: 'amy' },
      skip: 10,
      take: 10,
    }));
    expect(body).toMatchObject({ total: 25, hasMore: true });
    expect(body.sessions).toHaveLength(10);
  });

  it('pages the viewer\'s own sessions past the pinned current one', async () => {
    mocks.requireUser.mockResolvedValue(auth('member'));
    mocks.sessionCount.mockResolvedValue(12);
    mocks.sessionFindMany.mockResolvedValue([row('x'), row('y')]);

    const body = await (await get('?userId=me&skip=10')).json();

    // Position 0 is the pinned current session, so the rest start one earlier.
    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { ...ACTIVE, userId: 'me', NOT: { id: 'current' } },
      skip: 9,
      take: 10,
    }));
    expect(body).toMatchObject({ total: 12, hasMore: false });
    expect(body.sessions.map((s: { id: string }) => s.id)).toEqual(['x', 'y']);
  });

  it('caps the page size a client can ask for', async () => {
    mocks.requireUser.mockResolvedValue(auth('admin'));
    mocks.sessionCount.mockResolvedValue(0);

    await get('?userId=amy&take=5000');

    expect(mocks.sessionFindMany).toHaveBeenCalledWith(expect.objectContaining({ take: 50 }));
  });

  it('returns 401 without a session', async () => {
    mocks.requireUser.mockResolvedValue({ ok: false, response: Response.json({ error: 'Unauthorized' }, { status: 401 }) });

    const response = await get();

    expect(response.status).toBe(401);
    expect(mocks.userFindMany).not.toHaveBeenCalled();
  });
});
