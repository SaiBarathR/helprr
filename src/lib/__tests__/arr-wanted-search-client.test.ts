import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ post: vi.fn(), create: vi.fn() }));
vi.mock('axios', () => ({
  default: { create: mocks.create.mockImplementation(() => ({ post: mocks.post })) },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

describe('arr whole-list wanted search commands', () => {
  beforeEach(() => {
    mocks.post.mockReset().mockResolvedValue({ data: { id: 1 } });
  });

  it.each([
    ['Sonarr', () => new SonarrClient('http://sonarr.local', 'key'), 'v3', 'MissingEpisodeSearch', 'CutoffUnmetEpisodeSearch'],
    ['Radarr', () => new RadarrClient('http://radarr.local', 'key'), 'v3', 'MissingMoviesSearch', 'CutoffUnmetMoviesSearch'],
    ['Lidarr', () => new LidarrClient('http://lidarr.local', 'key'), 'v1', 'MissingAlbumSearch', 'CutoffUnmetAlbumSearch'],
  ])('%s posts its Missing and Cutoff Unmet search commands', async (_name, make, version, missing, cutoff) => {
    const client = make();
    await client.searchWanted('missing');
    expect(mocks.post).toHaveBeenLastCalledWith(`/api/${version}/command`, { name: missing }, undefined);
    await client.searchWanted('cutoff');
    expect(mocks.post).toHaveBeenLastCalledWith(`/api/${version}/command`, { name: cutoff }, undefined);
  });
});
