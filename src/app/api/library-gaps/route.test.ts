import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LibraryGapsResponse } from '@/types';

const mocks = vi.hoisted(() => ({
  user: { id: 'u1', role: 'admin' as string, template: 'member', permissions: null as unknown },
  cached: null as unknown,
  setCached: vi.fn(),
  lidarrArtists: [] as Array<() => Promise<unknown>>,
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: vi.fn(async () => ({ ok: true, user: mocks.user })),
}));
vi.mock('@/lib/api-logger', () => ({ withApiLogging: (handler: unknown) => handler }));
vi.mock('@/lib/cache/state', () => ({ getCacheGeneration: async () => 1 }));
vi.mock('@/lib/cache/library-gaps-cache', () => ({
  getCachedLibraryGaps: async () => mocks.cached,
  setCachedLibraryGaps: mocks.setCached,
}));
vi.mock('@/lib/service-helpers', () => ({
  getSonarrClients: async () => [{
    connection: { id: 'son-1' },
    client: {
      getSeries: async () => [{ id: 1, tvdbId: 11, title: 'Show', monitored: true, seasons: [], images: [], statistics: { episodeFileCount: 8, episodeCount: 10 } }],
      getWantedMissing: async () => ({ records: [] }),
    },
  }],
  getRadarrClients: async () => [],
  getLidarrClients: async () => mocks.lidarrArtists.map((getArtists, i) => ({ connection: { id: `lid-${i}` }, client: { getArtists } })),
}));

import { GET } from './route';

const artist = (mbid: string, monitored: boolean, trackFileCount: number, trackCount: number) => ({
  foreignArtistId: mbid, monitored, statistics: { trackFileCount, trackCount },
});

async function load(): Promise<LibraryGapsResponse> {
  return (await GET()).json();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.user = { id: 'u1', role: 'admin', template: 'member', permissions: null };
  mocks.cached = null;
  mocks.lidarrArtists = [];
});

describe('GET /api/library-gaps — music completeness', () => {
  it('adds a music tally of monitored artists’ tracks, deduped across Lidarr instances', async () => {
    mocks.lidarrArtists = [
      async () => [artist('a', true, 5, 10), artist('b', false, 0, 50)],
      async () => [artist('a', true, 7, 10), artist('c', true, 3, 20)],
    ];
    const { completeness } = await load();
    // Music is its own row; the blended percent stays TV + Movies.
    expect(completeness).toEqual({
      percent: 80,
      ownedUnits: 8,
      totalUnits: 10,
      tv: { owned: 8, total: 10 },
      movies: { owned: 0, total: 0 },
      music: { owned: 10, total: 30 },
    });
    expect(mocks.setCached).toHaveBeenCalledTimes(1);
  });

  it('omits music without Lidarr and does not cache when every Lidarr instance failed', async () => {
    const none = await load();
    expect(none.completeness?.music).toBeUndefined();
    expect(none.completeness?.percent).toBe(80);
    expect(mocks.setCached).toHaveBeenCalledTimes(1);

    mocks.setCached.mockClear();
    mocks.lidarrArtists = [async () => { throw new Error('down'); }];
    const failed = await load();
    expect(failed.completeness?.music).toBeUndefined();
    expect(mocks.setCached).not.toHaveBeenCalled();
  });

  it('drops the music tally for a viewer without music access, live and from cache', async () => {
    mocks.user = { id: 'u2', role: 'member', template: 'member', permissions: { 'series.view': true, 'movies.view': true, 'music.view': false } };
    mocks.lidarrArtists = [async () => [artist('a', true, 0, 90)]];
    const live = await load();
    expect(live.completeness).toEqual({
      percent: 80, ownedUnits: 8, totalUnits: 10, tv: { owned: 8, total: 10 }, movies: { owned: 0, total: 0 },
    });
    // The shared cache keeps the music tally for viewers who may see it.
    expect(mocks.setCached.mock.calls[0][0].completeness.music).toEqual({ owned: 0, total: 90 });

    mocks.cached = mocks.setCached.mock.calls[0][0];
    const fromCache = await load();
    expect(fromCache.completeness?.music).toBeUndefined();
    expect(fromCache.completeness?.percent).toBe(80);
  });
});
