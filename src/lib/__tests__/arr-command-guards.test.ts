import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The command and stats routes send only what Helprr's UI sends: Prowlarr's
 * command route runs an allow-list, per-title Sonarr/Radarr commands need
 * their ids (without them the app acts on the whole library), and the
 * library-wide commands are admin-only on a named instance. Refused input
 * never reaches the app.
 */

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  requireAdmin: vi.fn(),
  getClient: vi.fn(),
  listConnections: vi.fn(),
  sonarr: {
    searchEpisode: vi.fn(),
    searchSeason: vi.fn(),
    refreshSeries: vi.fn(),
    runLibraryCommand: vi.fn(),
  },
  radarr: {
    searchMovie: vi.fn(),
    refreshMovie: vi.fn(),
    renameMovie: vi.fn(),
    runLibraryCommand: vi.fn(),
  },
  prowlarr: { sendCommand: vi.fn(), getIndexerStats: vi.fn(), testIndexer: vi.fn() },
  logInfo: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: mocks.requireUserCapability,
  requireAdmin: mocks.requireAdmin,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (fn: unknown) => fn }));
vi.mock('@/lib/logger', () => ({ logger: { info: mocks.logInfo, warn: vi.fn(), error: vi.fn(), debug: vi.fn() } }));
vi.mock('@/lib/arr-instances', () => ({ listConnections: mocks.listConnections }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: async (id?: string) => { mocks.getClient('sonarr', id); return mocks.sonarr; },
  getRadarrClient: async (id?: string) => { mocks.getClient('radarr', id); return mocks.radarr; },
  getLidarrClient: async () => { throw new Error('not used'); },
  getProwlarrClient: async () => { mocks.getClient('prowlarr'); return mocks.prowlarr; },
}));

import { POST as prowlarrCommand } from '@/app/api/prowlarr/command/route';
import { GET as prowlarrStats } from '@/app/api/prowlarr/stats/route';
import { POST as prowlarrIndexerTest } from '@/app/api/prowlarr/indexers/[id]/test/route';
import { POST as sonarrCommand } from '@/app/api/sonarr/command/route';
import { POST as radarrCommand } from '@/app/api/radarr/command/route';
import { POST as sonarrLibraryCommand } from '@/app/api/sonarr/library-command/route';
import { POST as radarrLibraryCommand } from '@/app/api/radarr/library-command/route';

const admin = { id: 'admin-1', username: 'admin', role: 'admin', template: 'admin', permissions: {} };
const member = { id: 'member-1', username: 'member', role: 'member', template: 'custom', permissions: {} };
const forbidden = () => ({ ok: false, response: Response.json({ error: 'Forbidden' }, { status: 403 }) });

type Handler = (request: NextRequest) => Promise<Response>;
const post = (handler: Handler, path: string, body: unknown) =>
  handler(new NextRequest(`http://helprr.test${path}`, { method: 'POST', body: JSON.stringify(body) }));

const allUpstream = () => [
  ...Object.values(mocks.sonarr),
  ...Object.values(mocks.radarr),
  ...Object.values(mocks.prowlarr),
];
const expectNoUpstreamCall = () => {
  for (const fn of allUpstream()) expect(fn).not.toHaveBeenCalled();
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: admin });
  mocks.requireAdmin.mockResolvedValue({ ok: true, user: admin });
  mocks.listConnections.mockImplementation(async (type: string) => (
    type === 'SONARR' ? [{ id: 'son-1' }, { id: 'son-2' }] : [{ id: 'rad-1' }]
  ));
  const command = { id: 42, name: 'X', status: 'queued', body: { sendUpdatesToClient: true }, trigger: 'manual' };
  for (const fn of allUpstream()) fn.mockResolvedValue(command);
});

describe('POST /api/prowlarr/command', () => {
  it.each(['ApplicationIndexerSync', 'CheckHealth'])('sends %s, a command the UI uses', async (name) => {
    const res = await post(prowlarrCommand as Handler, '/api/prowlarr/command', { name });
    expect(res.status).toBe(200);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('prowlarr.manage');
    expect(mocks.prowlarr.sendCommand).toHaveBeenCalledWith(name);
  });

  it('answers with the command id, name and status only', async () => {
    const res = await post(prowlarrCommand as Handler, '/api/prowlarr/command', { name: 'CheckHealth' });
    expect(await res.json()).toEqual({ id: 42, name: 'X', status: 'queued' });
  });

  it('refuses CheckHealth without prowlarr.manage', async () => {
    mocks.requireUserCapability.mockResolvedValue(forbidden());
    const res = await post(prowlarrCommand as Handler, '/api/prowlarr/command', { name: 'CheckHealth' });
    expect(res.status).toBe(403);
    expectNoUpstreamCall();
  });

  it.each(['ApplicationUpdate', 'Backup', 'ClearHistory', 'DeleteLogFiles', 'applicationindexersync', 'checkhealth', 'Housekeeping'])(
    'refuses %s without calling Prowlarr',
    async (name) => {
      const res = await post(prowlarrCommand as Handler, '/api/prowlarr/command', { name });
      expect(res.status).toBe(400);
      expectNoUpstreamCall();
      expect(mocks.getClient).not.toHaveBeenCalled();
    },
  );

  it.each([[undefined], [''], [['ApplicationIndexerSync']], [{ name: 'ApplicationIndexerSync' }], [7]])(
    'refuses a name of %j',
    async (name) => {
      const res = await post(prowlarrCommand as Handler, '/api/prowlarr/command', { name });
      expect(res.status).toBe(400);
      expectNoUpstreamCall();
    },
  );
});

describe('GET /api/prowlarr/stats', () => {
  const get = (query: string) => prowlarrStats(new NextRequest(`http://helprr.test/api/prowlarr/stats${query}`));

  it('forwards a UTC ISO start time in its own spelling', async () => {
    const res = await get(`?startDate=${encodeURIComponent('2026-11-01T00:00:00Z')}`);
    expect(res.status).toBe(200);
    expect(mocks.prowlarr.getIndexerStats).toHaveBeenCalledWith({ startDate: '2026-11-01T00:00:00.000Z' });
  });

  it('asks for all time without a start', async () => {
    await get('');
    expect(mocks.prowlarr.getIndexerStats).toHaveBeenCalledWith({});
  });

  it.each(['yesterday', '', '2026-11-01', '2026-13-01T00:00:00Z', '2026-11-01T00:00:00+02:00', '2026-11-01T00:00:00Z&x=1', '1e12'])(
    'refuses %j without calling Prowlarr',
    async (startDate) => {
      const res = await get(`?startDate=${encodeURIComponent(startDate)}`);
      expect(res.status).toBe(400);
      expectNoUpstreamCall();
    },
  );
});

describe('POST /api/prowlarr/indexers/[id]/test', () => {
  it('answers with a fixed result, not what Prowlarr sent', async () => {
    mocks.prowlarr.testIndexer.mockResolvedValue({ fields: [{ name: 'apiKey', value: 'secret' }] });
    const res = await prowlarrIndexerTest(
      new NextRequest('http://helprr.test/api/prowlarr/indexers/12/test', { method: 'POST' }),
      { params: Promise.resolve({ id: '12' }) },
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(mocks.prowlarr.testIndexer).toHaveBeenCalledWith(12);
  });

  it('answers a failed test with a fixed message, not Prowlarr\'s', async () => {
    mocks.prowlarr.testIndexer.mockRejectedValue(new Error('Unable to connect to https://tracker.example/api?apikey=secret'));
    const res = await prowlarrIndexerTest(
      new NextRequest('http://helprr.test/api/prowlarr/indexers/12/test', { method: 'POST' }),
      { params: Promise.resolve({ id: '12' }) },
    );
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Test failed' });
  });
});

describe('POST /api/sonarr/command per-title ids', () => {
  const send = (body: unknown) => post(sonarrCommand as Handler, '/api/sonarr/command?instanceId=son-1', body);

  it.each([
    [{ name: 'RefreshSeries' }],
    [{ name: 'RefreshSeries', seriesId: 0 }],
    [{ name: 'RefreshSeries', seriesId: -3 }],
    [{ name: 'RefreshSeries', seriesId: 1.5 }],
    [{ name: 'RefreshSeries', seriesId: 'all' }],
    [{ name: 'EpisodeSearch' }],
    [{ name: 'EpisodeSearch', episodeIds: [] }],
    [{ name: 'EpisodeSearch', episodeIds: [11, 'x'] }],
    [{ name: 'EpisodeSearch', episodeIds: 11 }],
    [{ name: 'SeasonSearch', seasonNumber: 1 }],
    [{ name: 'SeasonSearch', seriesId: 7 }],
    [{ name: 'SeasonSearch', seriesId: 7, seasonNumber: -1 }],
    [{ name: 'SeasonSearch', seriesId: 7, seasonNumber: 1.5 }],
    [{ name: 'RssSync' }],
  ])('refuses %j without calling Sonarr', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expectNoUpstreamCall();
  });

  it('refreshes the one series named', async () => {
    const res = await send({ name: 'RefreshSeries', seriesId: 7 });
    expect(res.status).toBe(200);
    expect(mocks.sonarr.refreshSeries).toHaveBeenCalledWith(7);
  });

  it('searches the episodes named', async () => {
    await send({ name: 'EpisodeSearch', episodeIds: [11, 12] });
    expect(mocks.sonarr.searchEpisode).toHaveBeenCalledWith([11, 12]);
  });

  it('searches a season, Specials included', async () => {
    await send({ name: 'SeasonSearch', seriesId: 7, seasonNumber: 0 });
    expect(mocks.sonarr.searchSeason).toHaveBeenCalledWith(7, 0);
  });
});

describe('POST /api/radarr/command per-title ids', () => {
  const send = (body: unknown) => post(radarrCommand as Handler, '/api/radarr/command?instanceId=rad-1', body);

  it.each([
    [{ name: 'RefreshMovie' }],
    [{ name: 'RefreshMovie', movieId: 0 }],
    [{ name: 'RefreshMovie', movieId: [] }],
    [{ name: 'MoviesSearch' }],
    [{ name: 'MoviesSearch', movieIds: [] }],
    [{ name: 'MoviesSearch', movieIds: [21, -1] }],
    [{ name: 'RenameFiles' }],
    [{ name: 'RefreshCollections' }],
    [{ name: 'RssSync' }],
  ])('refuses %j without calling Radarr', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expectNoUpstreamCall();
  });

  it('refreshes the one movie named', async () => {
    const res = await send({ name: 'RefreshMovie', movieId: 21 });
    expect(res.status).toBe(200);
    expect(mocks.radarr.refreshMovie).toHaveBeenCalledWith(21);
  });

  it('searches the movies named', async () => {
    await send({ name: 'MoviesSearch', movieIds: [21, 22] });
    expect(mocks.radarr.searchMovie).toHaveBeenCalledWith([21, 22]);
  });
});

describe.each([
  { service: 'sonarr', handler: sonarrLibraryCommand as Handler, client: mocks.sonarr, instanceId: 'son-2', names: ['RssSync', 'RefreshSeries'] },
  { service: 'radarr', handler: radarrLibraryCommand as Handler, client: mocks.radarr, instanceId: 'rad-1', names: ['RssSync', 'RefreshMovie', 'RefreshCollections'] },
])('POST /api/$service/library-command', ({ service, handler, client, instanceId, names }) => {
  const send = (body: unknown, query = `?instanceId=${instanceId}`) => post(handler, `/api/${service}/library-command${query}`, body);

  it.each(names)('an admin runs %s without ids on the instance named', async (name) => {
    const res = await send({ name });
    expect(res.status).toBe(200);
    expect(mocks.getClient).toHaveBeenCalledWith(service, instanceId);
    expect(client.runLibraryCommand).toHaveBeenCalledWith(name);
    // Rebuilt: only what the page needs to follow the command.
    expect(await res.json()).toEqual({ id: 42, name: 'X', status: 'queued' });
    expect(mocks.logInfo).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({
      userId: 'admin-1', instanceId, command: name, commandId: 42,
    }), { scope: service });
  });

  it('refuses a member, whatever capabilities they hold', async () => {
    mocks.requireAdmin.mockResolvedValue(forbidden());
    mocks.requireUserCapability.mockResolvedValue({ ok: true, user: member });
    const res = await send({ name: 'RssSync' });
    expect(res.status).toBe(403);
    expectNoUpstreamCall();
    expect(mocks.getClient).not.toHaveBeenCalled();
  });

  it.each([
    [{ name: 'MissingEpisodeSearch' }],
    [{ name: 'ApplicationUpdate' }],
    [{ name: ['RssSync'] }],
    [{}],
    [null],
  ])('refuses %j', async (body) => {
    const res = await send(body);
    expect(res.status).toBe(400);
    expectNoUpstreamCall();
  });

  it('needs an instance, and never falls back to the default one', async () => {
    const res = await send({ name: 'RssSync' }, '');
    expect(res.status).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expectNoUpstreamCall();
  });

  it("refuses an instance that isn't one of the app's", async () => {
    const res = await send({ name: 'RssSync' }, `?instanceId=${service === 'sonarr' ? 'rad-1' : 'son-1'}`);
    expect(res.status).toBe(400);
    expect(mocks.getClient).not.toHaveBeenCalled();
    expectNoUpstreamCall();
  });
});
