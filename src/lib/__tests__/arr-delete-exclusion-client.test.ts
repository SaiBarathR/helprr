import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ delete: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ delete: mocks.delete })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

// Radarr spells the flag addImportExclusion; Sonarr and Lidarr addImportListExclusion.
describe('title deletes carry the import-list exclusion under each app\'s own name', () => {
  beforeEach(() => {
    mocks.delete.mockReset().mockResolvedValue({ data: undefined });
  });

  it('Sonarr', async () => {
    const client = new SonarrClient('http://sonarr.local', 'key');
    await client.deleteSeries(4, true, true);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v3/series/4', { params: { deleteFiles: true, addImportListExclusion: true } });
    await client.deleteSeriesBulk([4, 5], false, true);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v3/series/editor', {
      data: { seriesIds: [4, 5], deleteFiles: false, addImportListExclusion: true },
    });
  });

  it('Radarr', async () => {
    const client = new RadarrClient('http://radarr.local', 'key');
    await client.deleteMovie(4, false, true);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v3/movie/4', { params: { deleteFiles: false, addImportExclusion: true } });
    await client.deleteMoviesBulk([4, 5], true, true);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v3/movie/editor', {
      data: { movieIds: [4, 5], deleteFiles: true, addImportExclusion: true },
    });
  });

  it('Lidarr', async () => {
    const client = new LidarrClient('http://lidarr.local', 'key');
    await client.deleteArtist(4, false, true);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v1/artist/4', { params: { deleteFiles: false, addImportListExclusion: true } });
    await client.deleteArtistsBulk([4, 5], false, true);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v1/artist/editor', {
      data: { artistIds: [4, 5], deleteFiles: false, addImportListExclusion: true },
    });
  });

  it('leaves the exclusion off by default', async () => {
    await new SonarrClient('http://sonarr.local', 'key').deleteSeriesBulk([4]);
    expect(mocks.delete).toHaveBeenLastCalledWith('/api/v3/series/editor', {
      data: { seriesIds: [4], deleteFiles: false, addImportListExclusion: false },
    });
  });
});
