import { getTMDBClient, loadTaggedLibrary } from '@/lib/service-helpers';
import { annotateDiscoverItems, normalizeTmdbItem } from '@/lib/discover';
import { TmdbRateLimitError } from '@/lib/tmdb-client';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

const LIBRARY_CACHE_TTL_MS = 3 * 60 * 1000;

let libraryCache:
  | {
      expiresAt: number;
      data: Awaited<ReturnType<typeof loadTaggedLibrary>>;
    }
  | null = null;

async function getCachedTaggedLibrary(): Promise<Awaited<ReturnType<typeof loadTaggedLibrary>>> {
  const now = Date.now();
  if (libraryCache && libraryCache.expiresAt > now) return libraryCache.data;

  const data = await loadTaggedLibrary();
  libraryCache = { data, expiresAt: now + LIBRARY_CACHE_TTL_MS };
  return data;
}

export const searchTmdb: ProviderHandler = async ({ query, limit }) => {
  try {
    const tmdb = await getTMDBClient();
    const page = await tmdb.searchMulti(query, 1);

    let items = page.results
      .map((item) => normalizeTmdbItem(item, 'all'))
      .filter((item): item is NonNullable<typeof item> => item != null)
      .slice(0, limit);

    const { movies, series } = await getCachedTaggedLibrary();
    items = annotateDiscoverItems(items, movies, series);

    const results: SearchProviderResult[] = items.map((item) => {
      const inLibrary = item.library?.exists;
      return {
        id: `tmdb:${item.mediaType}:${item.tmdbId}`,
        title: item.title,
        subtitle: [item.year, item.mediaType === 'movie' ? 'Movie' : 'TV'].filter(Boolean).join(' · '),
        year: item.year,
        poster: item.posterPath,
        posterService: 'tmdb',
        route: item.mediaType === 'movie' ? `/discover/movie/${item.tmdbId}` : `/discover/tv/${item.tmdbId}`,
        provider: 'tmdb',
        badge: inLibrary ? 'In library' : undefined,
      };
    });

    return { results };
  } catch (error) {
    if (error instanceof TmdbRateLimitError) {
      return {
        results: [],
        rateLimited: {
          retryAfterSeconds: error.retryAfterSeconds ?? 60,
          retryAt: error.retryAt,
        },
      };
    }
    throw error;
  }
};
