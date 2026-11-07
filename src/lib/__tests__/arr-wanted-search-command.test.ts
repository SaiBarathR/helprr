import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Activity → Missing / Cutoff Unmet "Search all" sends each app's own
 * whole-list search command through the existing command routes, to the
 * instance named in the query, behind activity.manage. Radarr's Missing is the
 * exception: it searches the released missing films by id.
 */

const mocks = vi.hoisted(() => ({
  auth: vi.fn(),
  getClient: vi.fn(),
  client: { searchWanted: vi.fn(), getWantedMissing: vi.fn(), getQueue: vi.fn(), searchMovie: vi.fn() },
  logInfo: vi.fn(),
}));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.auth }));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: (id?: string) => mocks.getClient('sonarr', id),
  getRadarrClient: (id?: string) => mocks.getClient('radarr', id),
  getLidarrClient: (id?: string) => mocks.getClient('lidarr', id),
}));

import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';
import { POST as lidarrCommand } from '@/app/api/lidarr/command/route';

type Handler = (request: NextRequest) => Promise<Response>;
const post = (handler: Handler, service: string, name: string) =>
  handler(new NextRequest(`http://helprr.test/api/${service}/command?instanceId=inst-2`, {
    method: 'POST',
    body: JSON.stringify({ name }),
  }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.auth.mockResolvedValue({ ok: true, user: { id: 'admin', username: 'admin', role: 'admin' } });
  mocks.getClient.mockResolvedValue(mocks.client);
  mocks.client.searchWanted.mockResolvedValue({ id: 1, status: 'queued' });
  mocks.client.getQueue.mockResolvedValue({ records: [] });
  mocks.client.searchMovie.mockImplementation(async (ids: number[]) => ({ id: ids[0], name: 'MoviesSearch', status: 'queued' }));
});

describe.each([
  { service: 'sonarr', handler: sonarrCommand as Handler, missing: 'MissingEpisodeSearch', cutoff: 'CutoffUnmetEpisodeSearch' },
  { service: 'radarr', handler: radarrCommand as Handler, missing: 'MissingMoviesSearch', cutoff: 'CutoffUnmetMoviesSearch' },
  { service: 'lidarr', handler: lidarrCommand as Handler, missing: 'MissingAlbumSearch', cutoff: 'CutoffUnmetAlbumSearch' },
])('/api/$service/command wanted searches', ({ service, handler, missing, cutoff }) => {
  const wholeList = service === 'radarr' ? [[cutoff, 'cutoff']] : [[missing, 'missing'], [cutoff, 'cutoff']];
  it.each(wholeList)('%s searches the %s list on the named instance', async (name, type) => {
    const res = await post(handler, service, name);
    expect(res.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith('activity.manage');
    expect(mocks.getClient).toHaveBeenCalledWith(service, 'inst-2');
    expect(mocks.client.searchWanted).toHaveBeenCalledWith(type);
  });

  it('refuses a member without activity.manage before reaching the app', async () => {
    mocks.auth.mockResolvedValue({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });
    const res = await post(handler, service, missing);
    expect(res.status).toBe(403);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expect(mocks.client.searchWanted).not.toHaveBeenCalled();
  });
});

describe('/api/radarr/command MissingMoviesSearch', () => {
  const film = (id: number, dates: { inCinemas?: string; digitalRelease?: string; status?: string }) =>
    ({ id, title: `Film ${id}`, status: 'released', ...dates });
  const past = '2020-01-01T00:00:00Z';
  const future = '2999-01-01T00:00:00Z';

  it('searches only the released, unqueued missing films, by id, on the named instance', async () => {
    mocks.client.getWantedMissing.mockResolvedValue({
      totalRecords: 5,
      records: [
        film(1, { inCinemas: past }),
        film(2, { inCinemas: future, status: 'inCinemas' }),
        film(3, { inCinemas: future, digitalRelease: past }),
        film(4, { status: 'announced' }),
        film(5, { inCinemas: past }),
      ],
    });
    mocks.client.getQueue.mockResolvedValue({ records: [{ movieId: 5 }] });

    const res = await post(radarrCommand as Handler, 'radarr', 'MissingMoviesSearch');

    expect(res.status).toBe(200);
    expect(mocks.auth).toHaveBeenCalledWith('activity.manage');
    expect(mocks.getClient).toHaveBeenCalledWith('radarr', 'inst-2');
    expect(mocks.client.searchWanted).not.toHaveBeenCalled();
    expect(mocks.client.searchMovie).toHaveBeenCalledTimes(1);
    expect(mocks.client.searchMovie).toHaveBeenCalledWith([1, 3]);
    expect(await res.json()).toMatchObject({ movieCount: 2, queued: 2, notQueued: 0 });
    expect(mocks.logInfo).toHaveBeenCalledWith('Radarr Search all on Missing', {
      userId: 'admin', username: 'admin', instanceId: 'inst-2', queuedMovieIds: [1, 3], commandIds: [1], notQueuedMovieIds: [],
    }, { scope: 'radarr' });
  });

  it('reads every page and sends at most 100 films per command', async () => {
    const all = Array.from({ length: 730 }, (_, i) => film(i + 1, { inCinemas: past }));
    mocks.client.getWantedMissing.mockImplementation(async (page: number, size: number) =>
      ({ totalRecords: all.length, records: all.slice((page - 1) * size, page * size) }));

    const res = await post(radarrCommand as Handler, 'radarr', 'MissingMoviesSearch');

    expect(res.status).toBe(200);
    expect(mocks.client.getWantedMissing.mock.calls.map((c) => c[0])).toEqual([1, 2]);
    const batches = mocks.client.searchMovie.mock.calls.map((c) => c[0] as number[]);
    expect(batches).toHaveLength(8);
    expect(batches.every((ids) => ids.length <= 100)).toBe(true);
    expect(batches.flat()).toEqual(all.map((f) => f.id));
  });

  it('still searches when the queue cannot be read, and sends nothing when no film is out', async () => {
    mocks.client.getWantedMissing.mockResolvedValue({ totalRecords: 1, records: [film(1, { inCinemas: past })] });
    mocks.client.getQueue.mockRejectedValue(new Error('down'));
    await post(radarrCommand as Handler, 'radarr', 'MissingMoviesSearch');
    expect(mocks.client.searchMovie).toHaveBeenCalledWith([1]);

    mocks.client.searchMovie.mockClear();
    mocks.client.getWantedMissing.mockResolvedValue({ totalRecords: 1, records: [film(2, { status: 'announced' })] });
    const res = await post(radarrCommand as Handler, 'radarr', 'MissingMoviesSearch');
    expect(res.status).toBe(200);
    expect(mocks.client.searchMovie).not.toHaveBeenCalled();
    expect(await res.json()).toEqual({ movieCount: 0, queued: 0, notQueued: 0, commands: [], message: 'No released films are missing' });
  });

  it('reports a partial result, and logs what was queued, when a later batch is refused', async () => {
    const all = Array.from({ length: 250 }, (_, i) => film(i + 1, { inCinemas: past }));
    mocks.client.getWantedMissing.mockResolvedValue({ totalRecords: all.length, records: all });
    mocks.client.searchMovie
      .mockResolvedValueOnce({ id: 70, status: 'queued' })
      .mockRejectedValueOnce(new Error('Radarr answered 500'))
      .mockResolvedValueOnce({ id: 72, status: 'queued' });

    const res = await post(radarrCommand as Handler, 'radarr', 'MissingMoviesSearch');

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ movieCount: 250, queued: 150, notQueued: 100 });
    const logged = mocks.logInfo.mock.calls[0][1];
    expect(logged.commandIds).toEqual([70, 72]);
    expect(logged.queuedMovieIds).toEqual([...all.slice(0, 100), ...all.slice(200)].map((f) => f.id));
    expect(logged.notQueuedMovieIds).toEqual(all.slice(100, 200).map((f) => f.id));
  });

  it('fails, after logging, when Radarr queued none of the batches', async () => {
    mocks.client.getWantedMissing.mockResolvedValue({ totalRecords: 1, records: [film(1, { inCinemas: past })] });
    mocks.client.searchMovie.mockRejectedValue(new Error('Radarr answered 500'));

    const res = await post(radarrCommand as Handler, 'radarr', 'MissingMoviesSearch');

    expect(res.ok).toBe(false);
    expect(mocks.logInfo.mock.calls[0][1]).toMatchObject({ queuedMovieIds: [], notQueuedMovieIds: [1] });
  });
});
