import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), put: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ post: mocks.post, put: mocks.put })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

// Each *arr's bulk rename command binds a LIST of ids (SeriesIds / MovieIds /
// ArtistIds); a singular id field is ignored upstream and renames nothing.
describe('arr bulk rename and editor payloads', () => {
  beforeEach(() => {
    mocks.post.mockReset().mockResolvedValue({ data: { id: 1 } });
    mocks.put.mockReset().mockResolvedValue({ data: [] });
  });

  it('Sonarr RenameSeries sends seriesIds', async () => {
    await new SonarrClient('http://sonarr.local', 'key').renameSeries([3, 5]);
    expect(mocks.post).toHaveBeenLastCalledWith('/api/v3/command', { name: 'RenameSeries', seriesIds: [3, 5] }, undefined);
  });

  it('Radarr RenameMovie sends movieIds', async () => {
    await new RadarrClient('http://radarr.local', 'key').renameMovies([4]);
    expect(mocks.post).toHaveBeenLastCalledWith('/api/v3/command', { name: 'RenameMovie', movieIds: [4] }, undefined);
  });

  it('Lidarr RenameArtist sends artistIds', async () => {
    await new LidarrClient('http://lidarr.local', 'key').renameArtists([8, 9]);
    expect(mocks.post).toHaveBeenLastCalledWith('/api/v1/command', { name: 'RenameArtist', artistIds: [8, 9] }, undefined);
  });

  it('Sonarr series editor forwards the settings fields', async () => {
    await new SonarrClient('http://sonarr.local', 'key').seriesEditor({
      seriesIds: [1], qualityProfileId: 2, rootFolderPath: '/tv', moveFiles: true,
      seriesType: 'anime', seasonFolder: true, monitorNewItems: 'none',
    });
    expect(mocks.put).toHaveBeenLastCalledWith('/api/v3/series/editor', {
      seriesIds: [1], qualityProfileId: 2, rootFolderPath: '/tv', moveFiles: true,
      seriesType: 'anime', seasonFolder: true, monitorNewItems: 'none',
    });
  });
});
