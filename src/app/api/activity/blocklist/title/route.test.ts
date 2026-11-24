import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  listConnections: vi.fn(),
  getSonarrClient: vi.fn(),
  getRadarrClient: vi.fn(),
  sonarr: { getSeriesBlocklist: vi.fn() },
  radarr: { getMovieBlocklist: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({ requireUserCapability: mocks.requireUserCapability }));
vi.mock('@/lib/arr-instances', () => ({ listConnections: mocks.listConnections }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClient: mocks.getSonarrClient,
  getRadarrClient: mocks.getRadarrClient,
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));

import { GET } from './route';

const get = (query: string) => GET(new NextRequest(`http://localhost/api/activity/blocklist/title?${query}`));

// What the *arrs send: the whole movie/series rides along on every entry.
const radarrEntry = (id: number, movieId: number, date: string) => ({
  id, movieId, date, sourceTitle: `Movie.${id}.1080p`, protocol: 'torrent', indexer: 'YTS (Prowlarr)',
  message: 'Manually marked as failed', languages: [{ id: 1, name: 'English' }],
  quality: { quality: { id: 7, name: 'Bluray-1080p' }, revision: { version: 1 } },
  movie: { title: 'Secret', path: '/data/movies/Secret (2010)', rootFolderPath: '/data/movies' },
});
const sonarrEntry = (id: number, seriesId: number, date: string) => ({
  id, seriesId, episodeIds: [5], date, sourceTitle: `Show.S01E0${id}`, protocol: 'torrent',
  quality: { quality: { id: 15, name: 'WEBRip-1080p' } },
  series: { title: 'Show', path: '/data/tv/Show' },
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.requireUserCapability.mockResolvedValue({ ok: true, user: { id: 'u1' }, session: {} });
  mocks.listConnections.mockImplementation(async (type: string) => (
    type === 'SONARR' ? [{ id: 'son-1', label: 'Anime' }] : [{ id: 'rad-1', label: '4K' }]
  ));
  mocks.getSonarrClient.mockResolvedValue(mocks.sonarr);
  mocks.getRadarrClient.mockResolvedValue(mocks.radarr);
  mocks.radarr.getMovieBlocklist.mockResolvedValue([
    radarrEntry(1, 299, '2026-11-01T10:00:00Z'),
    radarrEntry(2, 299, '2026-11-04T10:00:00Z'),
  ]);
  mocks.sonarr.getSeriesBlocklist.mockResolvedValue({
    totalRecords: 2,
    records: [sonarrEntry(3, 214, '2026-11-04T10:00:00Z'), sonarrEntry(4, 9, '2026-11-05T10:00:00Z')],
  });
});

describe('GET /api/activity/blocklist/title', () => {
  it('needs activity.view, like the Activity blocklist', async () => {
    mocks.requireUserCapability.mockResolvedValueOnce({
      ok: false, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    expect((await get('source=radarr&movieId=299&instanceId=rad-1')).status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenCalledWith('activity.view');
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });

  it.each([
    ['source=lidarr&movieId=1&instanceId=rad-1', 'source'],
    ['source=radarr&instanceId=rad-1', 'movieId'],
    ['source=radarr&movieId=0&instanceId=rad-1', 'movieId'],
    ['source=radarr&seriesId=4&instanceId=rad-1', 'movieId'],
    ['source=sonarr&seriesId=abc&instanceId=son-1', 'seriesId'],
    ['source=radarr&movieId=299', 'instanceId'],
  ])('rejects %s', async (query, field) => {
    const response = await get(query);
    expect(response.status).toBe(400);
    expect((await response.json()).error).toContain(field);
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
    expect(mocks.getSonarrClient).not.toHaveBeenCalled();
  });

  it('rejects an instance of the other app instead of falling back to the default', async () => {
    const response = await get('source=radarr&movieId=299&instanceId=son-1');
    expect(response.status).toBe(400);
    expect(mocks.getRadarrClient).not.toHaveBeenCalled();
  });

  it('lists one movie newest first, rebuilt from an allow-list', async () => {
    const response = await get('source=radarr&movieId=299&instanceId=rad-1');
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(mocks.getRadarrClient).toHaveBeenCalledWith('rad-1');
    expect(mocks.radarr.getMovieBlocklist).toHaveBeenCalledWith(299);
    const body = await response.json();
    expect(body.records.map((r: { id: number }) => r.id)).toEqual([2, 1]);
    expect(body.records[0]).toEqual({
      id: 2,
      sourceTitle: 'Movie.2.1080p',
      date: '2026-11-04T10:00:00Z',
      protocol: 'torrent',
      indexer: 'YTS (Prowlarr)',
      message: 'Manually marked as failed',
      quality: { quality: { name: 'Bluray-1080p' } },
      source: 'radarr',
      instanceId: 'rad-1',
      instanceLabel: '4K',
    });
    expect(JSON.stringify(body)).not.toContain('/data/');
  });

  it("keeps only the series' entries when Sonarr ignores the seriesIds filter", async () => {
    const response = await get('source=sonarr&seriesId=214&instanceId=son-1');
    expect(response.status).toBe(200);
    expect(mocks.getSonarrClient).toHaveBeenCalledWith('son-1');
    expect(mocks.sonarr.getSeriesBlocklist).toHaveBeenCalledWith(214, 1000);
    const body = await response.json();
    expect(body.records.map((r: { id: number }) => r.id)).toEqual([3]);
    expect(body.truncated).toBe(false);
    expect(JSON.stringify(body)).not.toContain('/data/');
  });

  it('says when a series has more entries than one read lists', async () => {
    mocks.sonarr.getSeriesBlocklist.mockResolvedValue({ totalRecords: 1500, records: [sonarrEntry(3, 214, '2026-11-04T10:00:00Z')] });
    const body = await (await get('source=sonarr&seriesId=214&instanceId=son-1')).json();
    expect(body.truncated).toBe(true);
  });
});
