import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mocks = vi.hoisted(() => ({
  sonarrHistory: vi.fn(),
  lidarrHistory: vi.fn(),
  lidarrFails: false,
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: { id: 'u1', role: 'admin' } })),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => [{ connection: { id: 'son-1', label: 'Sonarr' }, client: { getHistory: mocks.sonarrHistory } }],
  getRadarrClients: async () => [],
  getLidarrClients: async () => {
    if (mocks.lidarrFails) throw new Error('down');
    return [{ connection: { id: 'lid-1', label: 'Lidarr' }, client: { getHistory: mocks.lidarrHistory } }];
  },
}));

import { GET } from './route';

const artist = { artistName: 'Massive Attack', images: [{ coverType: 'poster', remoteUrl: 'https://img/artist.jpg' }] };
const album = (id: number, title: string) => ({ id, title, images: [{ coverType: 'cover', remoteUrl: `https://img/${id}.jpg` }] });
const rec = (id: number, eventType: string, date: string, albumId?: number, extra: object = {}) => ({
  id, eventType, date, sourceTitle: `release-${id}`, albumId, artistId: 9, artist, album: albumId ? album(albumId, `Album ${albumId}`) : undefined, ...extra,
});

function get(limit = 10) {
  return GET(new NextRequest(`http://localhost/api/activity/recent?limit=${limit}`));
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.lidarrFails = false;
  mocks.sonarrHistory.mockResolvedValue({
    records: [{ id: 1, eventType: 'downloadFolderImported', date: '2026-11-01T10:00:00Z', sourceTitle: 's', seriesId: 4, series: { title: 'Show', images: [] }, episode: { seasonNumber: 1, episodeNumber: 2, title: 'Ep' } }],
  });
});

describe('GET /api/activity/recent — Lidarr imports', () => {
  it('adds one album card per imported album, newest first, with instance-scoped links', async () => {
    mocks.lidarrHistory.mockImplementation(async (_p, _s, _k, _d, filters?: { eventType?: number }) => filters?.eventType === 8
      // The downloadImported page reaches albums whose track rows fell off the unfiltered page.
      ? { records: [rec(28, 'downloadImported', '2026-11-03T12:00:01Z', 7), rec(3, 'downloadImported', '2026-10-20T08:00:00Z', 2)] }
      : { records: [
        rec(30, 'trackFileImported', '2026-11-03T12:00:03Z', 7),
        rec(29, 'trackFileImported', '2026-11-03T12:00:02Z', 7),
        rec(28, 'downloadImported', '2026-11-03T12:00:01Z', 7),
        rec(27, 'grabbed', '2026-11-03T11:00:00Z', 8),
        rec(26, 'albumImportIncomplete', '2026-11-02T11:00:00Z', 8),
        rec(25, 'trackFileImported', '2026-10-30T12:00:00Z', 5, { album: { id: 5, title: 'Album 5', images: [] } }),
      ] });

    const items = await (await get()).json();

    expect(mocks.lidarrHistory).toHaveBeenCalledWith(1, 50, 'date', 'descending');
    expect(mocks.lidarrHistory).toHaveBeenCalledWith(1, 50, 'date', 'descending', { eventType: 8 });
    expect(items.map((i: { id: string }) => i.id)).toEqual([
      'lidarr-lid-1-album-7',
      'sonarr-son-1-1',
      'lidarr-lid-1-album-5',
      'lidarr-lid-1-album-2',
    ]);
    expect(items[0]).toMatchObject({
      type: 'album',
      title: 'Massive Attack',
      subtitle: 'Album 7',
      date: '2026-11-03T12:00:03Z',
      poster: 'https://img/7.jpg',
      href: '/music/album/7?instance=lid-1',
      instanceId: 'lid-1',
      instanceLabel: 'Lidarr',
    });
    // No album cover → falls back to the artist poster.
    expect(items[2].poster).toBe('https://img/artist.jpg');
  });

  it('keeps Sonarr/Radarr results when Lidarr is unreachable', async () => {
    mocks.lidarrHistory.mockRejectedValue(new Error('timeout'));
    const res = await get();
    expect(res.status).toBe(200);
    expect((await res.json()).map((i: { id: string }) => i.id)).toEqual(['sonarr-son-1-1']);

    mocks.lidarrFails = true;
    const res2 = await get();
    expect(res2.status).toBe(200);
    expect(await res2.json()).toHaveLength(1);
  });
});
