import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

/**
 * Every list route a member can page through bounds what it passes on: a
 * hand-written query string cannot ask Prisma or a service for an unbounded
 * page, a negative slice or NaN. Invalid values fall back to the default and
 * out-of-range ones are clamped (the settled contract), so normal callers see
 * no change.
 */

const mocks = vi.hoisted(() => ({
  withRadarr: false,
  findMany: vi.fn(),
  count: vi.fn(),
  auditFindMany: vi.fn(),
  auditCount: vi.fn(),
  radarr: { getWantedMissing: vi.fn(), getCutoffUnmet: vi.fn() },
  sonarr: { getWantedMissing: vi.fn(), getCutoffUnmet: vi.fn(), getHistory: vi.fn() },
  prowlarrHistory: vi.fn(),
  resume: vi.fn(),
  lidarr: { getWantedMissing: vi.fn(), getCutoffUnmet: vi.fn() },
  seerr: { listUsers: vi.fn(), getUserRequests: vi.fn(), listRequests: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'admin-1', role: 'admin' } })),
  requireAdmin: vi.fn(async () => ({ ok: true, user: { id: 'admin-1', role: 'admin' } })),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/db', () => ({
  prisma: {
    notificationHistory: { findMany: mocks.findMany, count: mocks.count },
    fileOperationAudit: { findMany: mocks.auditFindMany, count: mocks.auditCount },
  },
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => [{ connection: { id: 'sonarr-1', label: 'Sonarr' }, client: mocks.sonarr }],
  getRadarrClients: async () => (mocks.withRadarr ? [{ connection: { id: 'radarr-1', label: 'Radarr' }, client: mocks.radarr }] : []),
  getLidarrClients: async () => [],
  getProwlarrClient: async () => ({ getHistory: mocks.prowlarrHistory }),
  getJellyfinClientForUser: async () => ({ getResumeItems: mocks.resume }),
  JellyfinNotLinkedError: class extends Error {},
  getLidarrClient: async () => mocks.lidarr,
  getSeerrClient: async () => mocks.seerr,
}));

import { GET as notifications } from '@/app/api/notifications/route';
import { GET as activityWanted } from '@/app/api/activity/wanted/route';
import { GET as activityRecent } from '@/app/api/activity/recent/route';
import { GET as prowlarrHistory } from '@/app/api/prowlarr/history/route';
import { GET as jellyfinResume } from '@/app/api/jellyfin/resume/route';
import { GET as lidarrWanted } from '@/app/api/lidarr/wanted/route';
import { GET as seerrUsers } from '@/app/api/seerr/users/route';
import { GET as seerrUserRequests } from '@/app/api/seerr/users/[id]/requests/route';
import { GET as seerrRequests } from '@/app/api/seerr/requests/route';
import { GET as fileAudit } from '@/app/api/file-audit/route';
import { parsePageNumber } from '@/lib/pagination';
import { ANILIST_DETAIL_PAGE_SIZE, maxAniListPage } from '@/lib/anilist-client';

const get = (path: string) => new NextRequest(`http://localhost:3050${path}`);

/** [query value, expected size] for a size parameter with this default and cap. */
function sizeCases(defaultSize: number, max: number): Array<[string | null, number]> {
  return [
    [null, defaultSize],
    ['0', 1],
    ['-5', 1],
    ['2.7', 2],
    ['NaN', defaultSize],
    ['Infinity', defaultSize],
    ['999999999999', max],
    ['7', 7],
    [String(max), max],
    [String(max + 1), max],
  ];
}

/** [query value, expected page] for a page parameter. */
const pageCases: Array<[string | null, number]> = [
  [null, 1],
  ['0', 1],
  ['-3', 1],
  ['2.5', 2],
  ['abc', 1],
  ['3', 3],
];

const query = (name: string, value: string | null) => (value === null ? '' : `${name}=${encodeURIComponent(value)}`);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.withRadarr = false;
  mocks.findMany.mockResolvedValue([]);
  mocks.auditFindMany.mockResolvedValue([]);
  mocks.auditCount.mockResolvedValue(0);
  mocks.sonarr.getCutoffUnmet.mockResolvedValue({ records: [], totalRecords: 0 });
  mocks.radarr.getWantedMissing.mockResolvedValue({ records: [], totalRecords: 0 });
  mocks.seerr.listRequests.mockResolvedValue({ results: [] });
  mocks.count.mockResolvedValue(0);
  mocks.sonarr.getWantedMissing.mockResolvedValue({ records: [], totalRecords: 0 });
  // More than any cap, so the slice is what limits the response.
  mocks.sonarr.getHistory.mockResolvedValue({ records: Array.from({ length: 300 }, (_, i) => ({ id: i, eventType: 'downloadFolderImported', date: new Date(2026, 0, 1, 0, i).toISOString(), seriesId: i, episodeId: i })) });
  mocks.prowlarrHistory.mockResolvedValue({ records: [] });
  mocks.resume.mockResolvedValue({ Items: [] });
  mocks.lidarr.getWantedMissing.mockResolvedValue({ records: [] });
  mocks.seerr.listUsers.mockResolvedValue({ results: [] });
  mocks.seerr.getUserRequests.mockResolvedValue({ results: [] });
});

describe('GET /api/notifications (at most 200 rows)', () => {
  it.each(sizeCases(50, 200))('pageSize=%s takes %d rows', async (raw, expected) => {
    const res = await notifications(get(`/api/notifications?${query('pageSize', raw)}`));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: expected }));
    expect(await res.json()).toMatchObject({ page: 1, pageSize: expected });
  });

  it.each(pageCases)('page=%s skips to page %d', async (raw, expected) => {
    const res = await notifications(get(`/api/notifications?pageSize=10&${query('page', raw)}`));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: (expected - 1) * 10, take: 10 }));
    expect(await res.json()).toMatchObject({ page: expected, pageSize: 10 });
  });

  it('caps a deep page at a 100,000-row offset', async () => {
    await notifications(get('/api/notifications?pageSize=100&page=999999999'));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 99_900, take: 100 }));
  });

  it('fits the tallest dashboard widget (100 grid rows asks for 165)', async () => {
    await notifications(get('/api/notifications?pageSize=165'));
    expect(mocks.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 165 }));
  });
});

describe('GET /api/activity/wanted (at most 100 rows)', () => {
  it.each(sizeCases(20, 100))('pageSize=%s asks the instance for %d', async (raw, expected) => {
    const res = await activityWanted(get(`/api/activity/wanted?type=missing&instanceId=sonarr-1&${query('pageSize', raw)}`));
    expect(mocks.sonarr.getWantedMissing).toHaveBeenCalledWith(1, expected);
    expect(await res.json()).toMatchObject({ page: 1, pageSize: expected });
  });

  it.each(pageCases)('page=%s asks the instance for page %d', async (raw, expected) => {
    await activityWanted(get(`/api/activity/wanted?type=missing&instanceId=sonarr-1&${query('page', raw)}`));
    expect(mocks.sonarr.getWantedMissing).toHaveBeenCalledWith(expected, 20);
  });

  it('bounds the cutoff list the same way', async () => {
    await activityWanted(get('/api/activity/wanted?type=cutoff&instanceId=sonarr-1&pageSize=99999'));
    expect(mocks.sonarr.getCutoffUnmet).toHaveBeenCalledWith(1, 100);
  });

  it('carves a bounded window across several instances', async () => {
    mocks.withRadarr = true;
    mocks.sonarr.getWantedMissing.mockImplementation(async (page: number, size: number) => ({ totalRecords: 150, records: Array.from({ length: Math.min(size, 150) }, (_, i) => ({ id: (page - 1) * size + i })) }));
    mocks.radarr.getWantedMissing.mockImplementation(async (page: number, size: number) => ({ totalRecords: 150, records: Array.from({ length: Math.min(size, 150) }, (_, i) => ({ id: 1000 + (page - 1) * size + i })) }));
    const res = await activityWanted(get('/api/activity/wanted?type=missing&pageSize=99999'));
    const body = await res.json();
    expect(body).toMatchObject({ page: 1, pageSize: 100, totalRecords: 300 });
    expect(body.records).toHaveLength(100);
    for (const call of [...mocks.sonarr.getWantedMissing.mock.calls, ...mocks.radarr.getWantedMissing.mock.calls]) {
      expect(call[1]).toBeLessThanOrEqual(100);
    }
  });
});

describe('GET /api/activity/recent (at most 250 rows)', () => {
  it.each(sizeCases(10, 250))('limit=%s returns %d', async (raw, expected) => {
    const res = await activityRecent(get(`/api/activity/recent?${query('limit', raw)}`));
    // Each instance is asked for its 50 newest records, so 50 is all there is.
    expect(mocks.sonarr.getHistory).toHaveBeenCalledWith(1, 50, 'date', 'descending');
    expect(await res.json()).toHaveLength(expected);
  });
});

describe('GET /api/prowlarr/history (at most 200 rows)', () => {
  it.each(sizeCases(50, 200))('pageSize=%s asks Prowlarr for %d', async (raw, expected) => {
    await prowlarrHistory(get(`/api/prowlarr/history?${query('pageSize', raw)}`));
    expect(mocks.prowlarrHistory).toHaveBeenCalledWith(expect.objectContaining({ page: 1, pageSize: expected }));
  });

  it.each(pageCases)('page=%s asks Prowlarr for page %d', async (raw, expected) => {
    await prowlarrHistory(get(`/api/prowlarr/history?${query('page', raw)}`));
    expect(mocks.prowlarrHistory).toHaveBeenCalledWith(expect.objectContaining({ page: expected, pageSize: 50 }));
  });

  it.each([
    ['indexerId=7&eventType=1', 7, 1],
    ['eventType=0', undefined, 0],
    ['indexerId=0&eventType=-1', undefined, undefined],
    ['indexerId=abc&eventType=NaN', undefined, undefined],
    ['indexerId=2.5&eventType=1e3', undefined, undefined],
    ['indexerId=99999999999', undefined, undefined],
  ])('%s filters by indexer %s and event %s, ignoring what is not a whole number', async (q, indexerId, eventType) => {
    await prowlarrHistory(get(`/api/prowlarr/history?${q}`));
    const args = mocks.prowlarrHistory.mock.calls[0][0];
    expect(args.indexerId).toBe(indexerId);
    expect(args.eventType).toBe(eventType);
  });
});

describe('GET /api/jellyfin/resume (at most 250 rows)', () => {
  it.each(sizeCases(10, 250))('limit=%s asks Jellyfin for %d', async (raw, expected) => {
    await jellyfinResume(get(`/api/jellyfin/resume?${query('limit', raw)}`));
    expect(mocks.resume).toHaveBeenCalledWith({ limit: expected });
  });
});

describe('GET /api/lidarr/wanted (at most 100 rows)', () => {
  it.each(sizeCases(20, 100))('pageSize=%s asks Lidarr for %d', async (raw, expected) => {
    await lidarrWanted(get(`/api/lidarr/wanted?${query('pageSize', raw)}`));
    expect(mocks.lidarr.getWantedMissing).toHaveBeenCalledWith(1, expected);
  });

  it.each(pageCases)('page=%s asks Lidarr for page %d', async (raw, expected) => {
    await lidarrWanted(get(`/api/lidarr/wanted?${query('page', raw)}`));
    expect(mocks.lidarr.getWantedMissing).toHaveBeenCalledWith(expected, 20);
  });
});

describe('Seerr user lists (at most 100 rows, offset bounded)', () => {
  it.each(sizeCases(100, 100))('users take=%s asks Seerr for %d', async (raw, expected) => {
    await seerrUsers(get(`/api/seerr/users?${query('take', raw)}`));
    expect(mocks.seerr.listUsers).toHaveBeenCalledWith(expect.objectContaining({ take: expected, skip: 0 }));
  });

  it.each(sizeCases(20, 100))("a user's requests take=%s asks Seerr for %d", async (raw, expected) => {
    await seerrUserRequests(get(`/api/seerr/users/4/requests?${query('take', raw)}`), { params: Promise.resolve({ id: '4' }) });
    expect(mocks.seerr.getUserRequests).toHaveBeenCalledWith(4, { take: expected, skip: 0 });
  });

  it.each([['-5', 0], ['abc', 0], ['40', 40], ['999999999', 100_000]] as Array<[string, number]>)('skip=%s is sent as %d', async (raw, expected) => {
    await seerrUsers(get(`/api/seerr/users?skip=${raw}`));
    expect(mocks.seerr.listUsers).toHaveBeenCalledWith(expect.objectContaining({ skip: expected }));
  });
});

describe('GET /api/seerr/requests (offset bounded)', () => {
  it.each([['-5', 0], ['abc', 0], ['40', 40], ['999999999', 100_000]] as Array<[string, number]>)('skip=%s is sent as %d', async (raw, expected) => {
    await seerrRequests(get(`/api/seerr/requests?skip=${raw}`));
    expect(mocks.seerr.listRequests).toHaveBeenCalledWith(expect.objectContaining({ skip: expected, take: 50 }));
  });
});

describe('GET /api/file-audit (at most 100 rows, whole numbers only)', () => {
  it.each(sizeCases(50, 100))('pageSize=%s takes %d rows', async (raw, expected) => {
    const res = await fileAudit(get(`/api/file-audit?${query('pageSize', raw)}`));
    expect(mocks.auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 0, take: expected }));
    expect(Number.isInteger(mocks.auditFindMany.mock.calls[0][0].take)).toBe(true);
    expect(await res.json()).toMatchObject({ page: 1, pageSize: expected });
  });

  it('caps a deep page at a 100,000-row offset', async () => {
    await fileAudit(get('/api/file-audit?page=999999999&pageSize=100'));
    expect(mocks.auditFindMany).toHaveBeenCalledWith(expect.objectContaining({ skip: 99_900, take: 100 }));
  });
});

describe('parsePageNumber (AniList and TMDB page numbers)', () => {
  it.each([[null, 1], ['0', 1], ['-2', 1], ['2.9', 2], ['abc', 1], ['7', 7], ['999999999999', 10_000]] as Array<[string | null, number]>)('page=%s is %d', (raw, expected) => {
    const sp = new URLSearchParams(raw === null ? '' : `page=${raw}`);
    expect(parsePageNumber(sp)).toBe(expected);
  });

  it('honours a service limit such as TMDB\'s 500 pages', () => {
    expect(parsePageNumber(new URLSearchParams('page=501'), { max: 500 })).toBe(500);
  });

  it("stops AniList pages at its 5,000-entry depth, which it refuses past", () => {
    expect(maxAniListPage(20)).toBe(250);
    expect(maxAniListPage(50)).toBe(100);
    expect(maxAniListPage(ANILIST_DETAIL_PAGE_SIZE)).toBe(200);
    expect(parsePageNumber(new URLSearchParams('page=999999999999'), { max: maxAniListPage(20) })).toBe(250);
  });
});
