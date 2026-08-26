import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ARR_RELEASE_TIMEOUT_MS } from '@/lib/arr-release-timeout';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  post: vi.fn(),
  create: vi.fn(),
}));

vi.mock('axios', () => ({
  default: {
    create: mocks.create.mockImplementation(() => ({
      get: mocks.get,
      post: mocks.post,
    })),
  },
}));

import { LidarrClient } from '@/lib/lidarr-client';
import { RadarrClient } from '@/lib/radarr-client';
import { SonarrClient } from '@/lib/sonarr-client';

describe('Arr interactive-search timeout', () => {
  beforeEach(() => {
    mocks.get.mockReset().mockResolvedValue({ data: [] });
    mocks.post.mockReset().mockResolvedValue({ data: {} });
    mocks.create.mockClear();
  });

  it('keeps the 30s default on the shared Arr axios clients', () => {
    new RadarrClient('http://radarr.local', 'key');
    new SonarrClient('http://sonarr.local', 'key');
    new LidarrClient('http://lidarr.local', 'key');

    expect(ARR_RELEASE_TIMEOUT_MS).toBe(300_000);
    for (const [config] of mocks.create.mock.calls) {
      expect(config).toMatchObject({ timeout: 30_000 });
    }
  });

  it('uses 300s for Radarr release search and grab, not ordinary reads', async () => {
    const client = new RadarrClient('http://radarr.local', 'key');

    await client.getReleases(540);
    expect(mocks.get).toHaveBeenCalledWith('/api/v3/release', {
      params: { movieId: 540 },
      timeout: ARR_RELEASE_TIMEOUT_MS,
    });

    await client.grabRelease('guid', 12, 3);
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v3/release',
      { guid: 'guid', indexerId: 12, downloadClientId: 3 },
      { timeout: ARR_RELEASE_TIMEOUT_MS },
    );

    mocks.get.mockClear();
    await client.getMovies();
    expect(mocks.get).toHaveBeenCalledWith('/api/v3/movie', { params: undefined });
    expect(mocks.get.mock.calls[0][1]).not.toHaveProperty('timeout');
  });

  it('uses 300s for Sonarr release search and grab, not ordinary reads', async () => {
    const client = new SonarrClient('http://sonarr.local', 'key');

    await client.getReleases({ episodeId: 88 });
    expect(mocks.get).toHaveBeenCalledWith('/api/v3/release', {
      params: { episodeId: 88 },
      timeout: ARR_RELEASE_TIMEOUT_MS,
    });

    await client.grabRelease('guid', 4);
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v3/release',
      { guid: 'guid', indexerId: 4 },
      { timeout: ARR_RELEASE_TIMEOUT_MS },
    );

    mocks.get.mockClear();
    await client.getSeries();
    expect(mocks.get).toHaveBeenCalledWith('/api/v3/series', { params: undefined });
    expect(mocks.get.mock.calls[0][1]).not.toHaveProperty('timeout');
  });

  it('uses 300s for Lidarr release search and grab, not ordinary reads', async () => {
    const client = new LidarrClient('http://lidarr.local', 'key');

    await client.getReleases({ albumId: 7 });
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/release', {
      params: { albumId: 7 },
      timeout: ARR_RELEASE_TIMEOUT_MS,
    });

    await client.grabRelease('guid', 9);
    expect(mocks.post).toHaveBeenCalledWith(
      '/api/v1/release',
      { guid: 'guid', indexerId: 9 },
      { timeout: ARR_RELEASE_TIMEOUT_MS },
    );

    mocks.get.mockClear();
    await client.getArtists();
    expect(mocks.get).toHaveBeenCalledWith('/api/v1/artist', { params: undefined });
    expect(mocks.get.mock.calls[0][1]).not.toHaveProperty('timeout');
  });
});
