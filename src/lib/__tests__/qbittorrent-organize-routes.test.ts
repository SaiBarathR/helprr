import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireUser: vi.fn(),
  requireUserCapability: vi.fn(),
  qbit: {
    setLocation: vi.fn(),
    addTags: vi.fn(),
    removeTags: vi.fn(),
    moveInQueue: vi.fn(),
    isQueueingEnabled: vi.fn(),
    getTags: vi.fn(),
    getDefaultSavePath: vi.fn(),
    getCategories: vi.fn(),
  },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.requireAuth,
  requireUser: mocks.requireUser,
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/service-helpers', () => ({ getQBittorrentClient: vi.fn().mockResolvedValue(mocks.qbit) }));
vi.mock('@/lib/file-audit', () => ({ deleteTorrentsAudited: vi.fn(), TORRENT_DELETE_REFUSALS: {} }));
vi.mock('@/lib/cache/qbittorrent-version', () => ({ bumpQbitCacheVersion: vi.fn() }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { POST as bulkAction } from '@/app/api/qbittorrent/route';
import { POST as hashAction } from '@/app/api/qbittorrent/[hash]/route';
import { GET as getOptions } from '@/app/api/qbittorrent/options/route';

const HASH = '0123456789abcdef0123456789abcdef01234567';
const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
// The member template does not grant torrents.manage.
const MEMBER = { id: 'u2', role: 'member', template: 'member', permissions: {} };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };

const json = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
// Both routes, so the single-torrent and bulk paths are held to the same rules.
const routes = {
  bulk: (body: Record<string, unknown>) => bulkAction(json('/api/qbittorrent', { hash: `${HASH}|${HASH}`, ...body })),
  single: (body: Record<string, unknown>) =>
    hashAction(json(`/api/qbittorrent/${HASH}`, body), { params: Promise.resolve({ hash: HASH }) }),
};
const sentHash = (route: keyof typeof routes) => (route === 'bulk' ? `${HASH}|${HASH}` : HASH);
const upstreamCalls = () => Object.values(mocks.qbit).filter((fn) => fn.mock.calls.length > 0 && fn !== mocks.qbit.getDefaultSavePath && fn !== mocks.qbit.getCategories);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.requireUser.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.qbit.isQueueingEnabled.mockResolvedValue(true);
  mocks.qbit.getDefaultSavePath.mockResolvedValue('/downloads');
  mocks.qbit.getCategories.mockResolvedValue({});
});

describe.each(['bulk', 'single'] as const)('%s torrent route', (route) => {
  const post = routes[route];

  it('moves torrents to a folder inside a download folder', async () => {
    const res = await post({ action: 'setLocation', location: ' /downloads/movies ' });
    expect(res.status).toBe(200);
    expect(mocks.qbit.setLocation).toHaveBeenCalledWith(sentHash(route), '/downloads/movies');
  });

  it.each([
    ['outside every download folder', '/etc'],
    ['a parent hop', '/downloads/../etc'],
    ['empty', '  '],
    ['a NUL byte', '/downloads/\u0000'],
    ['not a string', 7],
  ])('refuses a location %s', async (_label, location) => {
    const res = await post({ action: 'setLocation', location });
    expect(res.status).toBe(400);
    expect(mocks.qbit.setLocation).not.toHaveBeenCalled();
  });

  it('adds and removes tags', async () => {
    expect((await post({ action: 'addTags', tags: ['4k', ' new '] })).status).toBe(200);
    expect(mocks.qbit.addTags).toHaveBeenCalledWith(sentHash(route), ['4k', 'new']);
    expect((await post({ action: 'removeTags', tags: ['4k'] })).status).toBe(200);
    expect(mocks.qbit.removeTags).toHaveBeenCalledWith(sentHash(route), ['4k']);
  });

  it.each([
    ['no tags, which qBittorrent reads as remove every tag', undefined],
    ['an empty list', []],
    ['a comma inside a tag', ['a,b']],
  ])('refuses tags with %s', async (_label, tags) => {
    expect((await post({ action: 'removeTags', tags })).status).toBe(400);
    expect((await post({ action: 'addTags', tags })).status).toBe(400);
    expect(upstreamCalls()).toEqual([]);
  });

  it.each(['topPrio', 'increasePrio', 'decreasePrio', 'bottomPrio'])('moves torrents in the queue with %s', async (action) => {
    const res = await post({ action });
    expect(res.status).toBe(200);
    expect(mocks.qbit.moveInQueue).toHaveBeenCalledWith(sentHash(route), action);
  });

  it('says so, and moves nothing, while queueing is off', async () => {
    mocks.qbit.isQueueingEnabled.mockResolvedValue(false);
    const res = await post({ action: 'topPrio' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'Queueing is off in qBittorrent' });
    expect(mocks.qbit.moveInQueue).not.toHaveBeenCalled();
  });
});

describe('authorization', () => {
  const actions = [
    { action: 'setLocation', location: '/downloads/x' },
    { action: 'addTags', tags: ['x'] },
    { action: 'removeTags', tags: ['x'] },
    { action: 'topPrio' },
    { action: 'increasePrio' },
    { action: 'decreasePrio' },
    { action: 'bottomPrio' },
  ];

  it.each(actions)('the single-torrent route needs torrents.manage for $action', async (body) => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    const res = await routes.single(body);
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.manage');
    expect(upstreamCalls()).toEqual([]);
  });

  it.each(actions)('the bulk route refuses $action to a member without torrents.manage', async (body) => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    const res = await routes.bulk(body);
    expect(res.status).toBe(403);
    expect(upstreamCalls()).toEqual([]);
  });

  it('a member granted torrents.manage may tag', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...MEMBER, permissions: { 'torrents.manage': true } }, session: {} });
    expect((await routes.bulk({ action: 'addTags', tags: ['x'] })).status).toBe(200);
  });
});

describe('GET /api/qbittorrent/options', () => {
  it("returns qBittorrent's tags and whether queueing is on", async () => {
    mocks.qbit.getTags.mockResolvedValue(['4k']);
    mocks.qbit.isQueueingEnabled.mockResolvedValue(false);
    const res = await getOptions();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ tags: ['4k'], queueingEnabled: false });
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.view');
  });

  it('checks torrents.view before reading anything', async () => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    expect((await getOptions()).status).toBe(403);
    expect(mocks.qbit.getTags).not.toHaveBeenCalled();
  });
});
