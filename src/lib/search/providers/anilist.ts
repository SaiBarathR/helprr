import { loadCachedArrLibrary } from '@/lib/cache/arr-library';
import { searchAnime, AniListRateLimitError } from '@/lib/anilist-client';
import { normalizeAniListItem, isMovieFormat } from '@/lib/anilist-helpers';
import {
  buildLibraryLookups,
  matchMovieInLibrary,
  matchSeriesInLibrary,
  seriesLibraryStatusFromMatches,
  type Tagged,
} from '@/lib/discover';
import {
  loadLibraryLinksForAnilistIds,
  type AnilistLibraryLink,
} from '@/lib/anilist-series-mapping';
import type { RadarrMovie, SonarrSeries } from '@/types';
import type { AniListListItem } from '@/types/anilist';
import type { ProviderHandler } from '@/lib/search/providers/types';
import type { SearchProviderResult } from '@/lib/search/types';

function annotateItems(
  items: AniListListItem[],
  movies: Tagged<RadarrMovie>[],
  series: Tagged<SonarrSeries>[],
  mappingLinks: Map<number, AnilistLibraryLink[]>,
): AniListListItem[] {
  if (!movies.length && !series.length) return items;

  const lookups = buildLibraryLookups(movies, series);
  const seriesByKey = new Map<string, Tagged<SonarrSeries>>();
  for (const show of series) seriesByKey.set(`${show.instanceId}:${show.id}`, show);

  return items.map((item) => {
    if (isMovieFormat(item.format)) {
      const library = matchMovieInLibrary(lookups, { title: item.title, year: item.year });
      return { ...item, library: library ?? undefined } as AniListListItem & { library?: { exists: boolean } };
    }

    const matched = (mappingLinks.get(item.id) ?? [])
      .map((link) => seriesByKey.get(`${link.sonarrInstanceId}:${link.sonarrSeriesId}`))
      .filter((show): show is Tagged<SonarrSeries> => !!show);

    const library = matched.length
      ? seriesLibraryStatusFromMatches(matched)
      : matchSeriesInLibrary(lookups, { title: item.title, year: item.year });

    return { ...item, library: library ?? undefined } as AniListListItem & { library?: { exists: boolean } };
  });
}

export const searchAnilist: ProviderHandler = async ({ query, limit }) => {
  try {
    const libraryPromise = loadCachedArrLibrary();
    void libraryPromise.catch(() => undefined);
    const result = await searchAnime(query, 1, Math.min(limit, 20));
    const normalized = result.media.map(normalizeAniListItem);
    const mappingPromise = loadLibraryLinksForAnilistIds(
      normalized
        .filter((item) => !isMovieFormat(item.format))
        .map((item) => item.id),
    );
    const [{ movies, series }, mappingLinks] = await Promise.all([
      libraryPromise,
      mappingPromise,
    ]);
    const annotated = annotateItems(normalized, movies, series, mappingLinks);

    const results: SearchProviderResult[] = annotated.map((item) => {
      const lib = (item as AniListListItem & { library?: { exists: boolean } }).library;
      const subtitleParts = [item.year, item.format, item.status].filter(Boolean);
      return {
        id: `anilist:${item.id}`,
        title: item.title,
        subtitle: subtitleParts.join(' · '),
        year: item.year,
        poster: item.coverImage,
        posterService: 'anilist',
        route: `/anime/${item.id}`,
        provider: 'anilist',
        badge: lib?.exists ? 'In library' : undefined,
      };
    });

    return { results };
  } catch (error) {
    if (error instanceof AniListRateLimitError) {
      return {
        results: [],
        rateLimited: {
          retryAfterSeconds: error.retryAfterSeconds,
          retryAt: error.retryAt,
        },
      };
    }
    throw error;
  }
};
