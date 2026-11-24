import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  requireAuth: vi.fn(),
  requireUser: vi.fn(),
  requireUserCapability: vi.fn(),
  qbit: { setShareLimits: vi.fn() },
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

const HASH = '0123456789abcdef0123456789abcdef01234567';
const ADMIN = { id: 'u1', role: 'admin', template: 'admin', permissions: {} };
// The member template does not grant torrents.bandwidth.
const MEMBER = { id: 'u2', role: 'member', template: 'member', permissions: {} };
const FORBIDDEN = { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
const VALID = { ratioLimit: 1.5, seedingTimeLimit: 120, inactiveSeedingTimeLimit: -1 };

const json = (path: string, body: unknown) =>
  new NextRequest(`http://localhost${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
const routes = {
  bulk: (body: Record<string, unknown>) => bulkAction(json('/api/qbittorrent', { hash: `${HASH}|${HASH}`, ...body })),
  single: (body: Record<string, unknown>) =>
    hashAction(json(`/api/qbittorrent/${HASH}`, body), { params: Promise.resolve({ hash: HASH }) }),
};
const sentHash = (route: keyof typeof routes) => (route === 'bulk' ? `${HASH}|${HASH}` : HASH);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireAuth.mockResolvedValue(null);
  mocks.requireUser.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: ADMIN, session: {} });
});

describe.each(['bulk', 'single'] as const)('setShareLimits on the %s route', (route) => {
  const post = routes[route];

  it.each([
    ['custom limits', VALID, [1.5, 120, -1]],
    ['the global limits', { ratioLimit: -2, seedingTimeLimit: -2, inactiveSeedingTimeLimit: -2 }, [-2, -2, -2]],
    ['zero, which stops seeding at once', { ratioLimit: 0, seedingTimeLimit: 0, inactiveSeedingTimeLimit: 0 }, [0, 0, 0]],
    ['the largest limits', { ratioLimit: 9998, seedingTimeLimit: 525_600, inactiveSeedingTimeLimit: 525_600 }, [9998, 525_600, 525_600]],
  ])('sends %s', async (_label, limits, sent) => {
    const res = await post({ action: 'setShareLimits', ...limits });
    expect(res.status).toBe(200);
    expect(mocks.qbit.setShareLimits).toHaveBeenCalledWith(sentHash(route), ...sent);
  });

  it.each([
    // qBittorrent needs all three, and the old routes filled a missing one in as "use global".
    ['a missing inactive limit', { ratioLimit: 1, seedingTimeLimit: 60 }],
    ['no limits at all', {}],
    // qBittorrent reads text it can't parse as 0: stop seeding at once.
    ['a ratio as text', { ...VALID, ratioLimit: '2' }],
    ['a ratio of NaN', { ...VALID, ratioLimit: null }],
    ['a negative ratio other than -1 or -2', { ...VALID, ratioLimit: -0.5 }],
    ['a ratio qBittorrent shows as infinite', { ...VALID, ratioLimit: 9999 }],
    ['fractional minutes', { ...VALID, seedingTimeLimit: 1.5 }],
    ['a seeding time over a year', { ...VALID, seedingTimeLimit: 525_601 }],
    ['an inactive time of -3', { ...VALID, inactiveSeedingTimeLimit: -3 }],
    ['an inactive time as text', { ...VALID, inactiveSeedingTimeLimit: '30' }],
  ])('refuses %s and sends nothing', async (_label, limits) => {
    const res = await post({ action: 'setShareLimits', ...limits });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Enter a valid ratio and seeding time for each limit' });
    expect(mocks.qbit.setShareLimits).not.toHaveBeenCalled();
  });
});

describe('setShareLimits authorization', () => {
  it('the single-torrent route needs torrents.bandwidth', async () => {
    mocks.requireUserCapability.mockResolvedValue(FORBIDDEN);
    const res = await routes.single({ action: 'setShareLimits', ...VALID });
    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('torrents.bandwidth');
    expect(mocks.qbit.setShareLimits).not.toHaveBeenCalled();
  });

  it('the bulk route refuses a member without torrents.bandwidth', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: MEMBER, session: {} });
    expect((await routes.bulk({ action: 'setShareLimits', ...VALID })).status).toBe(403);
    expect(mocks.qbit.setShareLimits).not.toHaveBeenCalled();
  });

  it('the bulk route refuses torrents.manage alone', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...MEMBER, permissions: { 'torrents.manage': true } }, session: {} });
    expect((await routes.bulk({ action: 'setShareLimits', ...VALID })).status).toBe(403);
  });

  it('a member granted torrents.bandwidth may set them', async () => {
    mocks.requireUser.mockResolvedValue({ ok: true, user: { ...MEMBER, permissions: { 'torrents.bandwidth': true } }, session: {} });
    expect((await routes.bulk({ action: 'setShareLimits', ...VALID })).status).toBe(200);
  });
});
