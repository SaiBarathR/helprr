import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loadCachedArrLibrary: vi.fn(),
  getTMDBClient: vi.fn(),
  searchMulti: vi.fn(),
  annotateDiscoverItems: vi.fn((items) => items),
  normalizeTmdbItem: vi.fn((item) => item),
  searchAnime: vi.fn(),
  normalizeAniListItem: vi.fn((item) => item),
  isMovieFormat: vi.fn((format) => format === 'MOVIE'),
  loadLibraryLinksForAnilistIds: vi.fn(),
  buildLibraryLookups: vi.fn(),
  matchMovieInLibrary: vi.fn(),
  matchSeriesInLibrary: vi.fn(),
  seriesLibraryStatusFromMatches: vi.fn(),
}));

vi.mock('@/lib/cache/arr-library', () => ({
  loadCachedArrLibrary: mocks.loadCachedArrLibrary,
}));
vi.mock('@/lib/service-helpers', () => ({
  getTMDBClient: mocks.getTMDBClient,
}));
vi.mock('@/lib/discover', () => ({
  annotateDiscoverItems: mocks.annotateDiscoverItems,
  normalizeTmdbItem: mocks.normalizeTmdbItem,
  buildLibraryLookups: mocks.buildLibraryLookups,
  matchMovieInLibrary: mocks.matchMovieInLibrary,
  matchSeriesInLibrary: mocks.matchSeriesInLibrary,
  seriesLibraryStatusFromMatches: mocks.seriesLibraryStatusFromMatches,
}));
vi.mock('@/lib/anilist-client', () => ({
  searchAnime: mocks.searchAnime,
  AniListRateLimitError: class extends Error {},
}));
vi.mock('@/lib/anilist-helpers', () => ({
  normalizeAniListItem: mocks.normalizeAniListItem,
  isMovieFormat: mocks.isMovieFormat,
}));
vi.mock('@/lib/anilist-series-mapping', () => ({
  loadLibraryLinksForAnilistIds: mocks.loadLibraryLinksForAnilistIds,
}));
vi.mock('@/lib/tmdb-client', () => ({
  TmdbRateLimitError: class extends Error {},
}));

import { searchAnilist } from './anilist';
import { searchTmdb } from './tmdb';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

const context = { query: 'test', limit: 10, user: {} as never };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getTMDBClient.mockResolvedValue({ searchMulti: mocks.searchMulti });
  mocks.loadLibraryLinksForAnilistIds.mockResolvedValue(new Map());
});

describe('search library overlap', () => {
  it('starts the TMDB provider and shared library before either finishes', async () => {
    const library = deferred<{ movies: never[]; series: never[] }>();
    const page = deferred<{ results: unknown[] }>();
    mocks.loadCachedArrLibrary.mockReturnValue(library.promise);
    mocks.searchMulti.mockReturnValue(page.promise);

    const result = searchTmdb(context);

    await vi.waitFor(() => {
      expect(mocks.loadCachedArrLibrary).toHaveBeenCalledOnce();
      expect(mocks.searchMulti).toHaveBeenCalledWith('test', 1);
    });

    page.resolve({
      results: [{
        mediaType: 'movie',
        tmdbId: 7,
        title: 'Test',
        year: 2026,
        posterPath: null,
      }],
    });
    library.resolve({ movies: [], series: [] });

    await expect(result).resolves.toMatchObject({
      results: [{ id: 'tmdb:movie:7', title: 'Test' }],
    });
  });

  it('starts AniList mapping as soon as provider IDs arrive while the library is pending', async () => {
    const library = deferred<{ movies: never[]; series: never[] }>();
    const provider = deferred<{ media: unknown[] }>();
    mocks.loadCachedArrLibrary.mockReturnValue(library.promise);
    mocks.searchAnime.mockReturnValue(provider.promise);

    const result = searchAnilist(context);

    expect(mocks.loadCachedArrLibrary).toHaveBeenCalledOnce();
    expect(mocks.searchAnime).toHaveBeenCalledWith('test', 1, 10);

    provider.resolve({
      media: [{
        id: 42,
        title: 'Anime',
        year: 2026,
        format: 'TV',
        status: 'RELEASING',
        coverImage: null,
      }],
    });

    await vi.waitFor(() =>
      expect(mocks.loadLibraryLinksForAnilistIds).toHaveBeenCalledWith([42])
    );
    library.resolve({ movies: [], series: [] });

    await expect(result).resolves.toMatchObject({
      results: [{ id: 'anilist:42', title: 'Anime' }],
    });
  });
});
