import {
  buildLibraryLookups,
  matchMovieInLibrary,
  matchSeriesInLibrary,
  seriesLibraryStatusFromMatches,
  type Tagged,
} from '@/lib/discover';
import { loadLibraryLinksForAnilistIds, type AnilistLibraryLink } from '@/lib/anilist-series-mapping';
import { isMovieFormat } from '@/lib/anilist-helpers';
import type { RadarrMovie, SonarrSeries, DiscoverLibraryStatus } from '@/types';
import type { AniListMediaFormat } from '@/types/anilist';

/** Minimal item shape the annotator needs (AniListListItem satisfies it). */
export interface AnnotatableAnimeItem {
  id: number;
  title: string;
  titleRomaji?: string | null;
  titleNative?: string | null;
  format: AniListMediaFormat | null;
  year: number | null;
}

/**
 * Annotate AniList items with Sonarr/Radarr library membership. Movies match by
 * title/year (list items carry no tmdb id); series prefer the AniList↔Sonarr
 * reverse mapping (catches season splits) intersected with the live library,
 * falling back to title matching. Pass `mappingLinks` when the caller already
 * batched the reverse lookup across several item sets.
 */
export async function annotateAnimeItems<T extends AnnotatableAnimeItem>(
  items: T[],
  movies: Tagged<RadarrMovie>[],
  series: Tagged<SonarrSeries>[],
  mappingLinks?: Map<number, AnilistLibraryLink[]>
): Promise<(T & { library?: DiscoverLibraryStatus })[]> {
  if (!items.length || (!movies.length && !series.length)) return items;

  const lookups = buildLibraryLookups(movies, series);
  const links = mappingLinks ?? (await loadLibraryLinksForAnilistIds(items.map((item) => item.id)));
  const seriesByKey = new Map<string, Tagged<SonarrSeries>>();
  for (const show of series) seriesByKey.set(`${show.instanceId}:${show.id}`, show);

  return items.map((item) => {
    if (isMovieFormat(item.format)) {
      return {
        ...item,
        library: matchMovieInLibrary(lookups, {
          title: item.title,
          year: item.year,
        }),
      };
    }

    // Reverse mapping (AniList entry → Sonarr series) catches season splits that
    // title matching misses; intersect with the live library to drop stale links.
    const matched = (links.get(item.id) ?? [])
      .map((link) => seriesByKey.get(`${link.sonarrInstanceId}:${link.sonarrSeriesId}`))
      .filter((show): show is Tagged<SonarrSeries> => !!show);

    return {
      ...item,
      library: matched.length
        ? seriesLibraryStatusFromMatches(matched)
        : matchSeriesInLibrary(lookups, {
            title: item.title,
            titleRomaji: item.titleRomaji,
            titleNative: item.titleNative,
            year: item.year,
          }),
    };
  });
}
