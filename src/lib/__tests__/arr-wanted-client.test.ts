import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ get: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ get: mocks.get })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

// Sonarr and Radarr ignore a sort key outside their allow-list and fall back to
// their own default (Radarr: title), so these must be the exact upstream keys.
describe('arr wanted client sort keys', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ data: { records: [], totalRecords: 0 } });
  });

  it.each([
    ['missing', 'getWantedMissing'],
    ['cutoff', 'getCutoffUnmet'],
  ] as const)('Radarr wanted/%s sorts by cinema release, newest first', async (path, method) => {
    await new RadarrClient('http://radarr.local', 'key')[method](2, 40);
    expect(mocks.get).toHaveBeenLastCalledWith(`/api/v3/wanted/${path}`, {
      params: { page: 2, pageSize: 40, sortKey: 'movieMetadata.inCinemas', sortDirection: 'descending' },
    });
  });

  it('Radarr wanted/missing can be read oldest first', async () => {
    await new RadarrClient('http://radarr.local', 'key').getWantedMissing(1, 20, 'movieMetadata.inCinemas', 'ascending');
    expect(mocks.get).toHaveBeenLastCalledWith('/api/v3/wanted/missing', {
      params: { page: 1, pageSize: 20, sortKey: 'movieMetadata.inCinemas', sortDirection: 'ascending' },
    });
  });

  it('Radarr wanted/missing can be read by title instead', async () => {
    await new RadarrClient('http://radarr.local', 'key').getWantedMissing(1, 50, 'movieMetadata.sortTitle');
    expect(mocks.get).toHaveBeenLastCalledWith('/api/v3/wanted/missing', {
      params: { page: 1, pageSize: 50, sortKey: 'movieMetadata.sortTitle', sortDirection: 'descending' },
    });
  });

  it.each([
    ['missing', 'getWantedMissing'],
    ['cutoff', 'getCutoffUnmet'],
  ] as const)('Sonarr wanted/%s sorts by air date, newest first', async (path, method) => {
    await new SonarrClient('http://sonarr.local', 'key')[method](2, 40);
    expect(mocks.get).toHaveBeenLastCalledWith(`/api/v3/wanted/${path}`, {
      params: { page: 2, pageSize: 40, sortKey: 'episodes.airDateUtc', sortDirection: 'descending', includeSeries: true },
    });
  });

  it.each([
    ['missing', 'getWantedMissing'],
    ['cutoff', 'getCutoffUnmet'],
  ] as const)('Lidarr wanted/%s sorts by release date, newest first', async (path, method) => {
    await new LidarrClient('http://lidarr.local', 'key')[method](2, 40);
    expect(mocks.get).toHaveBeenLastCalledWith(`/api/v1/wanted/${path}`, {
      params: { page: 2, pageSize: 40, sortKey: 'releaseDate', sortDirection: 'descending', includeArtist: true },
    });
  });
});

describe('Sonarr cutoff unmet series ids', () => {
  const records = (ids: number[]) => ids.map((seriesId) => ({ seriesId }));

  beforeEach(() => mocks.get.mockReset());

  // Sonarr sorts only by air date, so paging could skip rows that share one at a page edge.
  it('reads the list as one page, one id per series, and says when it was cut short', async () => {
    mocks.get.mockResolvedValueOnce({ data: { totalRecords: 3, records: records([4, 4, 9]) } });
    const client = new SonarrClient('http://sonarr.local', 'key');
    expect(await client.getCutoffUnmetSeriesIds()).toEqual({ seriesIds: [4, 9], complete: true });
    expect(mocks.get).toHaveBeenCalledWith('/api/v3/wanted/cutoff', {
      params: { page: 1, pageSize: 20_000, includeSeries: false, includeEpisodeFile: false, includeImages: false, monitored: true },
      timeout: 60_000,
    });

    mocks.get.mockResolvedValueOnce({ data: { totalRecords: 30_000, records: records([1, 2]) } });
    expect(await client.getCutoffUnmetSeriesIds()).toEqual({ seriesIds: [1, 2], complete: false });
  });
});
