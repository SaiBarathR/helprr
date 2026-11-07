import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Sonarr, Radarr and Lidarr rename whatever file ids a RenameFiles command
 * carries, under the title it names; none of them checks that the files belong
 * to it. The command routes passed the request's ids straight through.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  sonarr: { getEpisodeFiles: vi.fn(), renameFiles: vi.fn(), renameSeries: vi.fn() },
  radarr: { getMovieFiles: vi.fn(), renameMovieFiles: vi.fn(), renameMovie: vi.fn() },
  lidarr: { getTrackFiles: vi.fn(), renameArtistFiles: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: async () => mocks.sonarr,
  getRadarrClient: async () => mocks.radarr,
  getLidarrClient: async () => mocks.lidarr,
}));
vi.mock('@/lib/api-error', () => ({
  upstreamErrorResponse: () => new Response(JSON.stringify({ error: 'upstream' }), { status: 502 }),
}));

import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';
import { POST as lidarrCommand } from '@/app/api/lidarr/command/route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (handler: Handler, service: string, body: unknown) =>
  handler(new NextRequest(`http://helprr.test/api/${service}/command`, { method: 'POST', body: JSON.stringify(body) }));

// A member who may manage the files of each kind of title.
const FILE_CAPS = { 'series.manageFiles': true, 'movies.manageFiles': true, 'music.manageFiles': true };

const cases = [
  {
    service: 'sonarr', handler: sonarrCommand as Handler, idKey: 'seriesId', fileCap: 'series.manageFiles', organize: 'RenameSeries', organizeKey: 'seriesIds',
    listed: mocks.sonarr.getEpisodeFiles, rename: mocks.sonarr.renameFiles, listedWith: [7],
  },
  {
    service: 'radarr', handler: radarrCommand as Handler, idKey: 'movieId', fileCap: 'movies.manageFiles', organize: 'RenameMovie', organizeKey: 'movieIds',
    listed: mocks.radarr.getMovieFiles, rename: mocks.radarr.renameMovieFiles, listedWith: [7],
  },
  {
    service: 'lidarr', handler: lidarrCommand as Handler, idKey: 'artistId', fileCap: 'music.manageFiles', organize: 'RenameArtist', organizeKey: 'artistIds',
    listed: mocks.lidarr.getTrackFiles, rename: mocks.lidarr.renameArtistFiles, listedWith: [{ artistId: 7 }],
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member', template: 'member', permissions: FILE_CAPS } });
  for (const { listed, rename } of cases) {
    listed.mockResolvedValue([{ id: 101 }, { id: 102 }, { id: 103 }]);
    rename.mockResolvedValue({ id: 900, name: 'RenameFiles' });
  }
});

describe.each(cases)('RenameFiles through /api/$service/command', ({ service, handler, idKey, listed, rename, listedWith }) => {
  it('renames files that belong to the title', async () => {
    const res = await post(handler, service, { name: 'RenameFiles', [idKey]: 7, files: [101, 103] });
    expect(res.status).toBe(200);
    expect(listed).toHaveBeenCalledWith(...listedWith);
    expect(rename).toHaveBeenCalledExactlyOnceWith(7, [101, 103]);
  });

  it('refuses a file id that belongs to another title', async () => {
    const res = await post(handler, service, { name: 'RenameFiles', [idKey]: 7, files: [101, 555] });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('555');
    expect(rename).not.toHaveBeenCalled();
  });

  it.each([
    ['ids that are not numbers', { [idKey]: 7, files: ['101; drop', {}] }],
    ['a title id that is not a number', { [idKey]: '7/../8', files: [101] }],
    ['no files', { [idKey]: 7, files: [] }],
  ])('rejects %s without asking the service anything', async (_label, body) => {
    const res = await post(handler, service, { name: 'RenameFiles', ...body });
    expect(res.status).toBe(400);
    expect(listed).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });
});

describe.each(cases)('renaming through /api/$service/command needs $fileCap', ({ service, handler, idKey, fileCap, organize, organizeKey, listed, rename }) => {
  it.each([
    ['activity.manage alone', { 'activity.manage': true }],
    ['the file capability turned off', { ...FILE_CAPS, [fileCap]: false }],
  ])('refuses a member with %s, asking the service nothing', async (_label, permissions) => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member', template: 'member', permissions } });
    for (const body of [
      { name: 'RenameFiles', [idKey]: 7, files: [101] },
      { name: organize, [organizeKey]: [7] },
    ]) {
      expect((await post(handler, service, body)).status).toBe(403);
    }
    expect(listed).not.toHaveBeenCalled();
    expect(rename).not.toHaveBeenCalled();
  });

  it('no longer lets music.delete stand in for music.manageFiles', async () => {
    if (service !== 'lidarr') return;
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'member', role: 'member', template: 'member', permissions: { 'activity.manage': true, 'music.delete': true } } });
    expect((await post(handler, service, { name: organize, [organizeKey]: [7] })).status).toBe(403);
    expect(rename).not.toHaveBeenCalled();
  });

  it('lets an admin rename without any override', async () => {
    mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', role: 'admin', template: 'admin', permissions: {} } });
    expect((await post(handler, service, { name: 'RenameFiles', [idKey]: 7, files: [101] })).status).toBe(200);
  });
});

describe('renames that name no files', () => {
  it('still renames a whole movie', async () => {
    mocks.radarr.renameMovie.mockResolvedValue({ id: 901 });
    const res = await post(radarrCommand as Handler, 'radarr', { name: 'RenameFiles', movieId: 7 });
    expect(res.status).toBe(200);
    expect(mocks.radarr.renameMovie).toHaveBeenCalledWith(7);
    expect(mocks.radarr.getMovieFiles).not.toHaveBeenCalled();
  });

  it('still renames a whole series', async () => {
    mocks.sonarr.renameSeries.mockResolvedValue({ id: 902 });
    const res = await post(sonarrCommand as Handler, 'sonarr', { name: 'RenameSeries', seriesId: 7 });
    expect(res.status).toBe(200);
    expect(mocks.sonarr.renameSeries).toHaveBeenCalledWith([7]);
  });
});
