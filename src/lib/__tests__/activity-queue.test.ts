import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getSonarrClients: vi.fn(), getRadarrClients: vi.fn(), getLidarrClients: vi.fn(),
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: mocks.getSonarrClients, getRadarrClients: mocks.getRadarrClients, getLidarrClients: mocks.getLidarrClients,
}));
vi.mock('@/lib/cache/json-cache', () => ({ getCachedJson: vi.fn().mockResolvedValue(null), setCachedJson: vi.fn() }));
vi.mock('@/lib/redis', () => ({ getRedisClient: vi.fn().mockResolvedValue({ get: vi.fn().mockResolvedValue(null) }) }));

import { getQueueCached } from '@/lib/activity-queue';

const instance = (id: string, records: unknown[]) => {
  const getQueue = vi.fn().mockResolvedValue({ records, totalRecords: records.length });
  return { entry: { connection: { id, label: id }, client: { getQueue } }, getQueue };
};

describe('activity queue', () => {
  beforeEach(() => vi.clearAllMocks());

  it('asks Sonarr and Radarr for downloads they could not match, and tags them like any other', async () => {
    // A torrent added by hand into Sonarr's category: tracked, but with no series.
    const sonarr = instance('son-1', [{ id: 1, downloadId: 'D', title: '[grp] Some Show 3rd Season', seriesId: null, trackedDownloadState: 'importBlocked' }]);
    const radarr = instance('rad-1', []);
    const lidarr = instance('lid-1', []);
    mocks.getSonarrClients.mockResolvedValue([sonarr.entry]);
    mocks.getRadarrClients.mockResolvedValue([radarr.entry]);
    mocks.getLidarrClients.mockResolvedValue([lidarr.entry]);

    const result = await getQueueCached(1, 50);

    expect(sonarr.getQueue).toHaveBeenCalledWith(1, 50, true);
    expect(radarr.getQueue).toHaveBeenCalledWith(1, 50, true);
    // The import page cannot act on Lidarr items, so its queue stays on the default view.
    expect(lidarr.getQueue).toHaveBeenCalledWith(1, 50, false);
    expect(result).toEqual({
      records: [expect.objectContaining({ downloadId: 'D', seriesId: null, source: 'sonarr', instanceId: 'son-1', instanceLabel: 'son-1' })],
      totalRecords: 1,
    });
  });
});
