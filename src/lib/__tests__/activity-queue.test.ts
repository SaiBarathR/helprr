import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSonarrClients: vi.fn(), getRadarrClients: vi.fn(), getLidarrClients: vi.fn(),
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: mocks.getSonarrClients, getRadarrClients: mocks.getRadarrClients, getLidarrClients: mocks.getLidarrClients,
}));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: vi.fn().mockResolvedValue(null), setCachedJson: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn().mockResolvedValue({ get: vi.fn().mockResolvedValue(null) }) }));

import { getQueueCached, getQueueNeedingImportCached } from '@/lib/activity-queue';

const instance = (id: string, records: unknown[]) => {
  const getQueue = vi.fn().mockResolvedValue({ records, totalRecords: records.length });
  return { entry: { connection: { id, label: id }, client: { getQueue } }, getQueue };
};

describe('activity queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks every arr for downloads it could not match, and tags them like any other', async () => {
    // A torrent added by hand into Sonarr's category: tracked, but with no series.
    const sonarr = instance('son-1', [{ id: 1, downloadId: 'D', title: '[grp] Some Show 3rd Season', seriesId: null, trackedDownloadState: 'importBlocked' }]);
    const radarr = instance('rad-1', []);
    const lidarr = instance('lid-1', []);
    mocks.getSonarrClients.mockResolvedValue([sonarr.entry]);
    mocks.getRadarrClients.mockResolvedValue([radarr.entry]);
    mocks.getLidarrClients.mockResolvedValue([lidarr.entry]);

    const result = await getQueueCached(1, 50, { includeLidarr: true });

    expect(sonarr.getQueue).toHaveBeenCalledWith(1, 50, true);
    expect(radarr.getQueue).toHaveBeenCalledWith(1, 50, true);
    expect(lidarr.getQueue).toHaveBeenCalledWith(1, 50, true);
    expect(result).toEqual({
      records: [expect.objectContaining({ downloadId: 'D', seriesId: null, source: 'sonarr', instanceId: 'son-1', instanceLabel: 'son-1' })],
      totalRecords: 1,
    });
  });

  it('lists a hand-added Lidarr download under Needs import', async () => {
    // A torrent put into Lidarr's category by hand: Lidarr tracks it but cannot
    // match an artist, so it waits on a manual import with no artist or album.
    const lidarr = instance('lid-1', [
      { id: 7, downloadId: 'L', title: 'The Shaggs - Wink (1967)', artistId: null, albumId: null, trackedDownloadState: 'importBlocked', trackedDownloadStatus: 'warning' },
      { id: 8, downloadId: 'M', title: 'Still downloading', artistId: 3, albumId: 4, trackedDownloadState: 'downloading', trackedDownloadStatus: 'ok' },
    ]);
    mocks.getSonarrClients.mockResolvedValue([]);
    mocks.getRadarrClients.mockResolvedValue([]);
    mocks.getLidarrClients.mockResolvedValue([lidarr.entry]);

    const result = await getQueueNeedingImportCached({ includeLidarr: true });

    expect(lidarr.getQueue).toHaveBeenCalledWith(1, 200, true);
    expect(result).toEqual({
      records: [expect.objectContaining({ id: 7, downloadId: 'L', source: 'lidarr', instanceId: 'lid-1' })],
      totalRecords: 1,
    });
  });

  it('leaves Lidarr out, rows and total, for a viewer without music.view, under its own cache key', async () => {
    const sonarr = instance('son-1', [{ id: 1, downloadId: 'S', seriesId: 2, trackedDownloadState: 'downloading' }]);
    const lidarr = instance('lid-1', [{ id: 7, downloadId: 'L', artistId: 3, albumId: 4, trackedDownloadState: 'importBlocked' }]);
    mocks.getSonarrClients.mockResolvedValue([sonarr.entry]);
    mocks.getRadarrClients.mockResolvedValue([]);
    mocks.getLidarrClients.mockResolvedValue([lidarr.entry]);

    const page = await getQueueCached(1, 50, { includeLidarr: false });
    const needing = await getQueueNeedingImportCached({ includeLidarr: false });

    expect(mocks.getLidarrClients).not.toHaveBeenCalled();
    expect(lidarr.getQueue).not.toHaveBeenCalled();
    expect(page).toEqual({ records: [expect.objectContaining({ downloadId: 'S', source: 'sonarr' })], totalRecords: 1 });
    expect(needing).toEqual({ records: [], totalRecords: 0 });
    // The full queue is cached for everyone else; the music-less one must never share its entry.
    const { setCachedJson } = await import('@/lib/cache/json-cache');
    expect(vi.mocked(setCachedJson).mock.calls.map(([, seed]) => seed)).toEqual(['0:1:50:no-lidarr', '0:needs-import:no-lidarr']);
  });
});
