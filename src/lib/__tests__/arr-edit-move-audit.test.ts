import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import { can } from '@/lib/permissions';
import type { Capability } from '@/lib/capabilities';

// The single-item Edit PUT routes: a file move (?moveFiles=true) needs the
// service's changePath capability and is recorded as MOVE_MEDIA, as the bulk
// editor's root-folder change is. Real permission resolution.

const mocks = vi.hoisted(() => ({
  user: null as null | Record<string, unknown>,
  runWithOperationAudit: vi.fn(),
  radarr: { getMovieById: vi.fn(), updateMovie: vi.fn() },
  sonarr: { getSeriesById: vi.fn(), updateSeries: vi.fn() },
  lidarr: { getArtistById: vi.fn(), updateArtist: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: async (cap: Capability) => {
    if (!mocks.user) return { ok: false, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
    return can(mocks.user as never, cap)
      ? { ok: true, user: mocks.user, session: {} }
      : { ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  },
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({
  getRadarrClient: async () => mocks.radarr,
  getSonarrClient: async () => mocks.sonarr,
  getLidarrClient: async () => mocks.lidarr,
}));
vi.mock('@/lib/file-audit', () => ({ runWithOperationAudit: mocks.runWithOperationAudit }));
vi.mock('@/lib/cache/tagged-library', () => ({ invalidateTaggedLibrary: vi.fn() }));

import { PUT as putMovie } from '@/app/api/radarr/[id]/route';
import { PUT as putSeries } from '@/app/api/sonarr/[id]/route';
import { PUT as putArtist } from '@/app/api/lidarr/[id]/route';

const ADMIN = { id: 'admin', username: 'owner', role: 'admin', template: 'admin', permissions: {} };
const member = (permissions: Record<string, boolean>) => ({ id: 'm', username: 'member', role: 'member', template: 'member', permissions });

const MOVIE = { id: 5, title: 'Movie', path: '/movies/Movie (2020)', monitored: false, tags: [], qualityProfileId: 1, minimumAvailability: 'released' };
const SERIES = { id: 6, title: 'Series', path: '/tv/Series', monitored: false, tags: [], seasons: [], qualityProfileId: 1, seriesType: 'standard', seasonFolder: true, monitorNewItems: 'all' };
const ARTIST = { id: 7, artistName: 'Artist', path: '/music/Artist', monitored: false, tags: [], qualityProfileId: 1, metadataProfileId: 1, monitorNewItems: 'all' };

const cases = [
  {
    name: 'Radarr', put: putMovie, base: '/api/radarr/5', id: '5', item: MOVIE, newPath: '/movies2/Movie (2020)',
    get: () => mocks.radarr.getMovieById, update: () => mocks.radarr.updateMovie,
    caps: { view: 'movies.view', path: 'movies.changePath', tags: 'movies.editTags' },
    audit: { service: 'RADARR', targetType: 'movie', targetTitle: 'Movie', fallbackTitle: 'Movie #5' },
  },
  {
    name: 'Sonarr', put: putSeries, base: '/api/sonarr/6', id: '6', item: SERIES, newPath: '/tv2/Series',
    get: () => mocks.sonarr.getSeriesById, update: () => mocks.sonarr.updateSeries,
    caps: { view: 'series.view', path: 'series.changePath', tags: 'series.editTags' },
    audit: { service: 'SONARR', targetType: 'series', targetTitle: 'Series', fallbackTitle: 'Series #6' },
  },
  {
    name: 'Lidarr', put: putArtist, base: '/api/lidarr/7', id: '7', item: ARTIST, newPath: '/music2/Artist',
    get: () => mocks.lidarr.getArtistById, update: () => mocks.lidarr.updateArtist,
    caps: { view: 'music.view', path: 'music.changePath', tags: 'music.editTags' },
    audit: { service: 'LIDARR', targetType: 'artist', targetTitle: 'Artist', fallbackTitle: 'Artist #7' },
  },
] as const;

function put(c: (typeof cases)[number], query: string, body: unknown) {
  return c.put(
    new NextRequest(`http://localhost${c.base}${query}`, { method: 'PUT', body: JSON.stringify(body) }),
    { params: Promise.resolve({ id: c.id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = ADMIN;
  mocks.runWithOperationAudit.mockImplementation(async (_input: unknown, op: () => Promise<unknown>) => op());
  for (const c of cases) {
    c.get().mockResolvedValue(c.item);
    c.update().mockImplementation(async (body: unknown) => body);
  }
});

describe.each(cases)('$name Edit PUT file moves', (c) => {
  it('audits a move to a new root folder as MOVE_MEDIA with both paths', async () => {
    const res = await put(c, '?moveFiles=true&instanceId=inst-1', { ...c.item, path: c.newPath });
    expect(res.status).toBe(200);
    expect(c.update()).toHaveBeenCalledWith(expect.objectContaining({ path: c.newPath }), true);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(1);
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toEqual({
      user: ADMIN,
      service: c.audit.service,
      instanceId: 'inst-1',
      operation: 'MOVE_MEDIA',
      targetType: c.audit.targetType,
      targetId: Number(c.id),
      targetTitle: c.audit.targetTitle,
      itemCount: 1,
      details: {
        targetIds: [Number(c.id)],
        fromPath: c.item.path,
        path: c.newPath,
        rootFolderPath: c.newPath.slice(0, c.newPath.lastIndexOf('/')),
        moveFiles: true,
      },
    });
  });

  it('does not audit an edit that moves nothing, and skips the extra read for an admin', async () => {
    await put(c, '?instanceId=inst-1', { ...c.item, tags: [3] });
    expect(c.update()).toHaveBeenCalledWith(expect.anything(), false);
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
    expect(c.get()).not.toHaveBeenCalled();
  });

  it("still moves when an admin's read for the audit row fails", async () => {
    c.get().mockRejectedValue(new Error('timeout'));
    const res = await put(c, '?moveFiles=true', { ...c.item, path: c.newPath });
    expect(res.status).toBe(200);
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toMatchObject({
      targetTitle: c.audit.fallbackTitle,
      details: { fromPath: null, path: c.newPath },
    });
  });

  it('records a refused move as a failed attempt and returns the error', async () => {
    c.update().mockRejectedValue(new Error('upstream refused'));
    mocks.runWithOperationAudit.mockImplementation(async (_input: unknown, op: () => Promise<unknown>) => op());
    const res = await put(c, '?moveFiles=true', { ...c.item, path: c.newPath });
    expect(res.status).toBe(500);
    expect(mocks.runWithOperationAudit).toHaveBeenCalledTimes(1);
  });

  it('refuses a file move from a member without changePath, even with the path unchanged', async () => {
    mocks.user = member({ [c.caps.view]: true, [c.caps.tags]: true, [c.caps.path]: false });
    const res = await put(c, '?moveFiles=true', { ...c.item });
    expect(res.status).toBe(403);
    expect(c.update()).not.toHaveBeenCalled();
    expect(mocks.runWithOperationAudit).not.toHaveBeenCalled();
  });

  it('lets a member with changePath move, and audits it under their name', async () => {
    const user = member({ [c.caps.view]: true, [c.caps.path]: true });
    mocks.user = user;
    const res = await put(c, '?moveFiles=true', { ...c.item, path: c.newPath });
    expect(res.status).toBe(200);
    expect(mocks.runWithOperationAudit.mock.calls[0][0]).toMatchObject({ user, operation: 'MOVE_MEDIA' });
  });
});
