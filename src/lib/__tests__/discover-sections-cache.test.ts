import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';
import type { DiscoverItem, DiscoverResponse } from '@/types';

const mocks = vi.hoisted(() => ({
  requireUserCapability: vi.fn(),
  getTMDBClient: vi.fn(),
  loadTaggedLibrary: vi.fn(),
  getCachedTaggedLibrary: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireUserCapability: mocks.requireUserCapability,
}));
vi.mock('@/lib/api-logger', () => ({
  withApiLogging: (handler: unknown) => handler,
}));
vi.mock('@/lib/service-helpers', () => ({
  getTMDBClient: mocks.getTMDBClient,
  getRadarrClients: vi.fn(),
  getSonarrClients: vi.fn(),
}));
// The route reads library state through the shared tagged-library cache; each
// request asks for it once, and this mock answers from the current library.
vi.mock('@/lib/cache/tagged-library', () => ({
  getCachedTaggedLibrary: mocks.getCachedTaggedLibrary,
}));

const MOVIE = { id: 101, title: 'Catalog Movie', release_date: '2024-01-01', popularity: 5 };
const SHOW = { id: 202, name: 'Catalog Show', first_air_date: '2023-01-01', popularity: 4 };

function listOf(results: object[]) {
  return vi.fn(async () => ({ page: 1, total_pages: 1, total_results: results.length, results }));
}

function tmdbClient(options: { fail?: boolean } = {}) {
  const list = (results: object[]) => options.fail
    ? vi.fn(async () => { throw new Error('TMDB down'); })
    : listOf(results);
  return {
    trending: list([{ ...MOVIE, media_type: 'movie' }, { ...SHOW, media_type: 'tv' }]),
    discoverMovie: list([MOVIE]),
    discoverTv: list([SHOW]),
    nowPlayingMovies: list([MOVIE]),
    airingTodayTv: list([SHOW]),
    topRatedMovies: list([MOVIE]),
    topRatedTv: list([SHOW]),
    movieGenres: vi.fn(async () => []),
    tvGenres: vi.fn(async () => []),
    movieWatchProviders: vi.fn(async () => []),
    tvWatchProviders: vi.fn(async () => []),
  };
}

function library(movieIds: number[], instanceId = 'radarr-hd') {
  return {
    movies: movieIds.map((tmdbId) => ({
      id: tmdbId * 10,
      tmdbId,
      title: `Library ${tmdbId}`,
      titleSlug: `library-${tmdbId}`,
      year: 1990,
      instanceId,
      instanceLabel: instanceId,
    })),
    series: [],
  };
}

const allowed = { ok: true, user: { id: 'member', role: 'member' }, session: {} };

async function loadRoute() {
  vi.resetModules();
  return import('@/app/api/discover/route');
}

function sectionsRequest(query = '') {
  return new NextRequest(`http://localhost/api/discover?mode=sections${query}`);
}

function popularMovie(body: DiscoverResponse): DiscoverItem {
  const section = body.sections!.find((s) => s.key === 'popular_movies')!;
  return (section.items as DiscoverItem[])[0];
}

describe('GET /api/discover sections cache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
    mocks.requireUserCapability.mockResolvedValue(allowed);
    mocks.loadTaggedLibrary.mockResolvedValue(library([]));
    let pending: Promise<ReturnType<typeof library>> | null = null;
    mocks.getCachedTaggedLibrary.mockImplementation(async ({ scope }: { scope: string }) => {
      // Radarr and Sonarr are read together; one library snapshot serves both.
      pending ??= mocks.loadTaggedLibrary() as Promise<ReturnType<typeof library>>;
      const snapshot: ReturnType<typeof library> = await pending;
      if (scope === 'sonarr') pending = null;
      return { items: scope === 'radarr' ? snapshot.movies : snapshot.series };
    });
  });

  it('rejects an unauthenticated request before returning a warm cached body', async () => {
    const tmdb = tmdbClient();
    mocks.getTMDBClient.mockResolvedValue(tmdb);
    const { GET } = await loadRoute();
    expect((await GET(sectionsRequest())).status).toBe(200);
    mocks.loadTaggedLibrary.mockClear();

    mocks.requireUserCapability.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    });
    const res = await GET(sectionsRequest());

    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: 'Unauthorized' });
    expect(mocks.loadTaggedLibrary).not.toHaveBeenCalled();
  });

  it('returns 403 without discover.view even when the catalog cache is warm', async () => {
    mocks.getTMDBClient.mockResolvedValue(tmdbClient());
    const { GET } = await loadRoute();
    await GET(sectionsRequest());

    mocks.requireUserCapability.mockResolvedValueOnce({
      ok: false,
      response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }),
    });
    const res = await GET(sectionsRequest());

    expect(res.status).toBe(403);
    expect(mocks.requireUserCapability).toHaveBeenLastCalledWith('discover.view');
  });

  it('never marks the annotated response as publicly cacheable', async () => {
    mocks.getTMDBClient.mockResolvedValue(tmdbClient());
    const { GET } = await loadRoute();

    for (const res of [await GET(sectionsRequest()), await GET(sectionsRequest())]) {
      const cacheControl = res.headers.get('cache-control') ?? '';
      expect(cacheControl).toContain('private');
      expect(cacheControl).not.toMatch(/public|s-maxage/);
      expect(res.headers.get('vary')).toContain('Cookie');
    }
  });

  it('annotates one warm catalog against each request’s library without refetching TMDB', async () => {
    const tmdb = tmdbClient();
    mocks.getTMDBClient.mockResolvedValue(tmdb);
    const { GET } = await loadRoute();

    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([MOVIE.id], 'radarr-hd'));
    const first = popularMovie(await (await GET(sectionsRequest())).json());
    const tmdbCalls = tmdb.discoverMovie.mock.calls.length;

    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([MOVIE.id], 'radarr-4k'));
    const second = popularMovie(await (await GET(sectionsRequest())).json());

    expect(first.library).toMatchObject({ exists: true, instanceId: 'radarr-hd' });
    expect(second.library).toMatchObject({ exists: true, instanceId: 'radarr-4k' });
    expect(tmdb.discoverMovie.mock.calls.length).toBe(tmdbCalls);
    expect(mocks.getTMDBClient).toHaveBeenCalledTimes(1);
  });

  it('shows an item added between two requests as present at once', async () => {
    mocks.getTMDBClient.mockResolvedValue(tmdbClient());
    const { GET } = await loadRoute();

    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([]));
    const before = popularMovie(await (await GET(sectionsRequest())).json());
    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([MOVIE.id]));
    const after = popularMovie(await (await GET(sectionsRequest())).json());

    expect(before.library?.exists ?? false).toBe(false);
    expect(after.library).toMatchObject({ exists: true, id: MOVIE.id * 10 });
  });

  it('drops library state for an item removed between two requests', async () => {
    mocks.getTMDBClient.mockResolvedValue(tmdbClient());
    const { GET } = await loadRoute();

    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([MOVIE.id]));
    const before = popularMovie(await (await GET(sectionsRequest())).json());
    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([]));
    const after = popularMovie(await (await GET(sectionsRequest())).json());

    expect(before.library).toMatchObject({ exists: true });
    // Would still be present if an annotated body had reached the catalog cache.
    expect(after.library?.exists ?? false).toBe(false);
  });

  it('still serves the catalog when library state cannot be read', async () => {
    mocks.getTMDBClient.mockResolvedValue(tmdbClient());
    const { GET } = await loadRoute();
    mocks.getCachedTaggedLibrary.mockRejectedValue(new Error('database unavailable'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const res = await GET(sectionsRequest());
    warn.mockRestore();

    expect(res.status).toBe(200);
    expect(popularMovie(await res.json())).toMatchObject({ title: MOVIE.title });
  });

  it('falls back to the cached catalog with the current library when TMDB fails', async () => {
    vi.useFakeTimers();
    mocks.getTMDBClient.mockResolvedValueOnce(tmdbClient());
    const { GET } = await loadRoute();
    await GET(sectionsRequest());

    vi.advanceTimersByTime(6 * 60 * 1000);
    mocks.getTMDBClient.mockResolvedValueOnce(tmdbClient({ fail: true }));
    mocks.loadTaggedLibrary.mockResolvedValueOnce(library([MOVIE.id], 'radarr-now'));
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const res = await GET(sectionsRequest());
    warn.mockRestore();

    expect(res.status).toBe(200);
    expect(popularMovie(await res.json())).toMatchObject({
      title: MOVIE.title,
      library: { exists: true, instanceId: 'radarr-now' },
    });
  });

  it('keeps perSectionLimit between 1 and 60', async () => {
    const many = Array.from({ length: 20 }, (_, i) => ({ ...MOVIE, id: 1000 + i, title: `Movie ${i}` }));
    const tmdb = tmdbClient();
    tmdb.discoverMovie = listOf(many);
    mocks.getTMDBClient.mockResolvedValue(tmdb);
    const { GET } = await loadRoute();

    const count = async (limit: string) => {
      const body: DiscoverResponse = await (await GET(sectionsRequest(`&perSectionLimit=${limit}`))).json();
      return (body.sections!.find((s) => s.key === 'popular_movies')!.items as DiscoverItem[]).length;
    };

    expect(await count('0')).toBe(1);
    expect(await count('-5')).toBe(1);
    expect(await count('2')).toBe(2);
    // Three TMDB pages of 20 are fetched, so the cap of 60 is the whole section.
    expect(await count('500')).toBe(60);
  });
});
