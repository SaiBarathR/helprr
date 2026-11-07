import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeHashRedis } from '@/lib/__tests__/helpers/fake-hash-redis';

type TestUser = {
  id: string; displayName: string; role: 'admin' | 'member'; template: string;
  permissions: Record<string, boolean>; status: 'active' | 'disabled'; jellyfinUserId: string | null;
};

const mocks = vi.hoisted(() => ({
  user: null as unknown as TestUser,
  users: [] as TestUser[],
  redis: null as unknown,
  notifyEvent: vi.fn(async () => 1),
  fetchMoviePool: vi.fn(),
  fetchSeriesPool: vi.fn(async () => [] as unknown[]),
}));

vi.mock('@/lib/auth', async () => {
  const { can } = await import('@/lib/permissions');
  return {
    requireUserCapability: vi.fn(async (cap: string) => (can(mocks.user as never, cap as never)
      ? { ok: true, user: mocks.user }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) })),
  };
});
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn(async () => mocks.redis) }));
vi.mock('@/lib/service-helpers', () => ({}));
vi.mock('@/lib/db', () => ({
  prisma: {
    user: {
      findMany: vi.fn(async ({ where }: { where: { id?: { in?: string[]; not?: string }; status?: string } }) =>
        mocks.users.filter((u) =>
          (!where.id?.in || where.id.in.includes(u.id))
          && (!where.id?.not || u.id !== where.id.not)
          && (!where.status || u.status === where.status))),
    },
  },
}));
// No real pushes from tests.
vi.mock('@/lib/notification-service', () => ({ notifyEvent: mocks.notifyEvent }));
vi.mock('@/lib/random-watch-pool', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/random-watch-pool')>()),
  fetchMoviePool: mocks.fetchMoviePool,
  fetchSeriesPool: mocks.fetchSeriesPool,
}));

import { POST as startPick } from './route';
import { GET as getMembers } from './members/route';
import { DELETE as endPick, GET as getPick } from './[id]/route';
import { POST as joinPick } from './[id]/join/route';
import { POST as votePick } from './[id]/vote/route';

const person = (id: string, extra: Partial<TestUser> = {}): TestUser => ({
  id, displayName: id[0].toUpperCase() + id.slice(1), role: 'member', template: 'member',
  permissions: {}, status: 'active', jellyfinUserId: null, ...extra,
});

const sai = person('sai');
const mum = person('mum');
const dad = person('dad');
const stranger = person('stranger');

function json(body: unknown): NextRequest {
  return new NextRequest('http://helprr.test/api/tonight', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const blank = () => new NextRequest('http://helprr.test/api/tonight/x');

async function startAs(user: TestUser, body: Record<string, unknown>) {
  mocks.user = user;
  return startPick(json(body));
}

async function startedId(): Promise<string> {
  const res = await startAs(sai, { type: 'movie', watch: 'all', inviteeIds: ['mum'] });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

beforeEach(() => {
  mocks.redis = new FakeHashRedis();
  mocks.users = [sai, mum, dad, stranger];
  mocks.notifyEvent.mockClear();
  mocks.fetchMoviePool.mockResolvedValue(
    Array.from({ length: 5 }, (_, i) => ({ id: i + 1, instanceId: 'r1', title: `M${i}`, hasFile: true, images: [], genres: [], imdbId: '', tmdbId: i + 1 })),
  );
});

describe('POST /api/tonight', () => {
  it('starts a pick, invites by push through notifyEvent, and returns the link', async () => {
    const res = await startAs(sai, { type: 'movie', watch: 'all', inviteeIds: ['mum', 'dad'] });
    expect(res.status).toBe(201);
    const body = await res.json() as { id: string; link: string; view: { titles: unknown[]; participants: unknown[] } };
    expect(body.link).toBe(`/recommendations?mode=random&tonight=${body.id}`);
    expect(body.view.titles).toHaveLength(5);
    expect(body.view.participants).toHaveLength(3);
    await vi.waitFor(() => expect(mocks.notifyEvent).toHaveBeenCalledTimes(2));
  });

  it.each([
    ['nobody', []],
    ['yourself', ['sai']],
    ['an unknown person', ['ghost']],
  ])('refuses inviting %s', async (_label, inviteeIds) => {
    const res = await startAs(sai, { type: 'movie', watch: 'all', inviteeIds });
    expect(res.status).toBe(400);
    expect(mocks.notifyEvent).not.toHaveBeenCalled();
  });

  it('refuses inviting someone disabled or without Random', async () => {
    mocks.users = [sai, person('mum', { status: 'disabled' }), person('dad', { permissions: { 'random.view': false } })];
    expect((await startAs(sai, { type: 'movie', watch: 'all', inviteeIds: ['mum'] })).status).toBe(400);
    expect((await startAs(sai, { type: 'movie', watch: 'all', inviteeIds: ['dad'] })).status).toBe(400);
  });

  it('refuses a starter without Random', async () => {
    const res = await startAs(person('sai', { permissions: { 'random.view': false } }), { type: 'movie', watch: 'all', inviteeIds: ['mum'] });
    expect(res.status).toBe(403);
  });

  it('says so when nothing matches for everyone', async () => {
    mocks.fetchMoviePool.mockResolvedValue([]);
    const res = await startAs(sai, { type: 'movie', watch: 'all', inviteeIds: ['mum'] });
    expect(res.status).toBe(422);
  });

  it('rejects bad filters', async () => {
    expect((await startAs(sai, { type: 'music', watch: 'all', inviteeIds: ['mum'] })).status).toBe(400);
    expect((await startAs(sai, { type: 'movie', watch: 'all', runtime: 'forever', inviteeIds: ['mum'] })).status).toBe(400);
    expect((await startAs(sai, { type: 'movie', watch: 'all', genres: 'Comedy', inviteeIds: ['mum'] })).status).toBe(400);
    expect((await startAs(sai, { type: 'movie', watch: 'all', genres: [7], inviteeIds: ['mum'] })).status).toBe(400);
  });

  it('deals only titles in the chosen genres and length, and keeps the filters on the pick', async () => {
    mocks.fetchMoviePool.mockResolvedValue([
      { id: 1, instanceId: 'r1', title: 'Short comedy', hasFile: true, images: [], genres: ['Comedy'], runtime: 85, imdbId: '', tmdbId: 1 },
      { id: 2, instanceId: 'r1', title: 'Long comedy', hasFile: true, images: [], genres: ['Comedy'], runtime: 140, imdbId: '', tmdbId: 2 },
      { id: 3, instanceId: 'r1', title: 'Short drama', hasFile: true, images: [], genres: ['Drama'], runtime: 80, imdbId: '', tmdbId: 3 },
    ]);
    const res = await startAs(sai, { type: 'movie', watch: 'all', genres: ['Comedy'], runtime: 'under90', inviteeIds: ['mum'] });
    expect(res.status).toBe(201);
    const { view } = await res.json() as { view: { titles: { id: number }[]; filters: unknown } };
    expect(view.titles.map((t) => t.id)).toEqual([1]);
    expect(view.filters).toEqual({ type: 'movie', watch: 'all', genres: ['Comedy'], runtime: 'under90' });
  });

  it('sets a length aside on a series-only pick', async () => {
    mocks.fetchSeriesPool.mockResolvedValueOnce([
      { id: 9, instanceId: 's1', title: 'S', images: [], genres: [], runtime: 45, imdbId: '', tmdbId: 0, tvdbId: 90, statistics: { episodeFileCount: 1 } },
    ]);
    const res = await startAs(sai, { type: 'series', watch: 'all', runtime: 'over120', inviteeIds: ['mum'] });
    expect(res.status).toBe(201);
    const { view } = await res.json() as { view: { titles: { id: number }[]; filters: { runtime: string } } };
    expect(view.titles.map((t) => t.id)).toEqual([9]);
    expect(view.filters.runtime).toBe('any');
  });
});

describe('GET /api/tonight/members', () => {
  it('lists other active people who can use Random, names only', async () => {
    mocks.users = [sai, mum, person('dad', { status: 'disabled' }), person('kid', { permissions: { 'random.view': false } })];
    mocks.user = sai;
    const res = await getMembers();
    expect(await res.json()).toEqual({ members: [{ id: 'mum', name: 'Mum' }] });
  });
});

describe('joining and reading a pick', () => {
  it('lets an invitee join and read it', async () => {
    const id = await startedId();
    mocks.user = mum;
    const res = await joinPick(blank(), ctx(id));
    expect(res.status).toBe(200);
    const view = await res.json() as { participants: { id: string; joined: boolean }[] };
    expect(view.participants.find((p) => p.id === 'mum')?.joined).toBe(true);
    expect((await getPick(blank(), ctx(id))).status).toBe(200);
  });

  it('refuses someone who was not invited with the same 404 as a missing pick', async () => {
    const id = await startedId();
    mocks.user = stranger;
    const join = await joinPick(blank(), ctx(id));
    expect(join.status).toBe(404);
    expect((await getPick(blank(), ctx(id))).status).toBe(404);
    expect((await votePick(json({ index: 0, yes: true }), ctx(id))).status).toBe(404);
    // An admin who was not invited is refused too.
    mocks.user = person('admin', { role: 'admin', template: 'admin' });
    expect((await getPick(blank(), ctx(id))).status).toBe(404);
  });

  it('answers 404 for a malformed or unknown id', async () => {
    mocks.user = mum;
    expect((await getPick(blank(), ctx('../x'))).status).toBe(404);
    expect((await getPick(blank(), ctx('A'.repeat(22)))).status).toBe(404);
  });

  it('refuses an invitee who has since lost the right to view the titles', async () => {
    const id = await startedId();
    mocks.user = person('mum', { permissions: { 'movies.view': false } });
    expect((await getPick(blank(), ctx(id))).status).toBe(403);
    expect((await votePick(json({ index: 0, yes: true }), ctx(id))).status).toBe(403);
  });
});

describe('voting and ending', () => {
  it('matches when both say yes, and validates the vote', async () => {
    const id = await startedId();
    mocks.user = mum;
    await joinPick(blank(), ctx(id));
    expect((await votePick(json({ index: 99, yes: true }), ctx(id))).status).toBe(400);
    expect((await votePick(json({ index: 0, yes: 'yes' }), ctx(id))).status).toBe(400);
    await votePick(json({ index: 2, yes: true }), ctx(id));
    mocks.user = sai;
    const res = await votePick(json({ index: 2, yes: true }), ctx(id));
    expect(await res.json()).toMatchObject({ status: 'matched', winnerIndex: 2 });
  });

  it('only the starter can end it', async () => {
    const id = await startedId();
    mocks.user = mum;
    expect((await endPick(blank(), ctx(id))).status).toBe(403);
    mocks.user = sai;
    const res = await endPick(blank(), ctx(id));
    expect(await res.json()).toMatchObject({ status: 'ended' });
    mocks.user = mum;
    expect(await (await getPick(blank(), ctx(id))).json()).toMatchObject({ status: 'ended' });
  });
});
