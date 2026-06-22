import type {
  DiscoverItem,
  DiscoverMediaType,
  RadarrMovie,
  SonarrSeries,
  DiscoverLibraryStatus,
} from '@/types';
import type { TmdbListItem } from '@/lib/tmdb-client';

/** A library item tagged with the instance it came from. */
export type Tagged<T> = T & { instanceId: string; instanceLabel: string };

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function tmdbImageUrl(path: string | null | undefined, size: 'w300' | 'w500' | 'w780' | 'w1280' | 'original' = 'w500'): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

/** Lowercase, strip punctuation/diacritics to spaces, collapse. The shared basis
 * for both dedup keys and search text-matching so they agree on title equality. */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function normalizeTitleKey(title: string, year: number | null) {
  return `${normalizeTitle(title)}::${year ?? 'na'}`;
}

function normalizeBaseTitle(title: string) {
  return title
    .toLowerCase()
    // Strip common seasonal suffixes: "Season 2", "2nd Season", "Part 2", "Cour 2", etc.
    .replace(/\s+(?:season|part|cour|2nd|3rd|[0-9]+th)\s*([0-9]+)?/gi, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function asYear(value?: string) {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

export function normalizeTmdbItem(
  item: TmdbListItem,
  mediaTypeHint: DiscoverMediaType | 'all' = 'all'
): DiscoverItem | null {
  const mediaType = mediaTypeHint === 'all'
    ? (item.media_type === 'movie' ? 'movie' : item.media_type === 'tv' ? 'tv' : null)
    : mediaTypeHint;

  if (!mediaType) return null;

  const title = mediaType === 'movie' ? (item.title || '') : (item.name || '');
  if (!title) return null;

  const releaseDate = mediaType === 'movie'
    ? (item.release_date || null)
    : (item.first_air_date || null);

  return {
    id: item.id,
    tmdbId: item.id,
    mediaType,
    title,
    originalTitle: mediaType === 'movie' ? item.original_title || undefined : item.original_name || undefined,
    overview: item.overview || '',
    posterPath: tmdbImageUrl(item.poster_path),
    backdropPath: tmdbImageUrl(item.backdrop_path, 'w1280'),
    releaseDate,
    year: asYear(releaseDate || undefined),
    rating: item.vote_average || 0,
    voteCount: item.vote_count || 0,
    popularity: item.popularity || 0,
    genres: item.genre_ids || [],
    originalLanguage: item.original_language,
    originCountry: item.origin_country || [],
  };
}

// Every map value is an array because the same id/title can exist in multiple
// instances (e.g. an HD + a 4K Radarr both holding the same movie).
interface LibraryLookups {
  movieByTmdbId: Map<number, Tagged<RadarrMovie>[]>;
  movieByImdbId: Map<string, Tagged<RadarrMovie>[]>;
  movieByTitleYear: Map<string, Tagged<RadarrMovie>[]>;
  seriesByTvdbId: Map<number, Tagged<SonarrSeries>[]>;
  seriesByImdbId: Map<string, Tagged<SonarrSeries>[]>;
  seriesByTmdbId: Map<number, Tagged<SonarrSeries>[]>;
  seriesByTitleYear: Map<string, Tagged<SonarrSeries>[]>;
  seriesByBaseTitle: Map<string, Tagged<SonarrSeries>[]>;
}

function selectBestSeriesMatch(candidates: Tagged<SonarrSeries>[], year: number | null): Tagged<SonarrSeries> | null {
  if (!candidates.length) return null;
  if (year == null) return candidates[0];

  let best = candidates[0];
  let bestDistance = Math.abs((best.year ?? year) - year);

  for (const candidate of candidates.slice(1)) {
    const distance = Math.abs((candidate.year ?? year) - year);
    if (distance < bestDistance) {
      best = candidate;
      bestDistance = distance;
    }
  }

  return best;
}

export function buildLibraryLookups(
  movies: Tagged<RadarrMovie>[],
  series: Tagged<SonarrSeries>[]
): LibraryLookups {
  const movieByTmdbId = new Map<number, Tagged<RadarrMovie>[]>();
  const movieByImdbId = new Map<string, Tagged<RadarrMovie>[]>();
  const movieByTitleYear = new Map<string, Tagged<RadarrMovie>[]>();
  const seriesByTvdbId = new Map<number, Tagged<SonarrSeries>[]>();
  const seriesByImdbId = new Map<string, Tagged<SonarrSeries>[]>();
  const seriesByTmdbId = new Map<number, Tagged<SonarrSeries>[]>();
  const seriesByTitleYear = new Map<string, Tagged<SonarrSeries>[]>();
  const seriesByBaseTitle = new Map<string, Tagged<SonarrSeries>[]>();

  const push = <K, V>(m: Map<K, V[]>, k: K, v: V) => {
    const a = m.get(k) ?? [];
    a.push(v);
    m.set(k, a);
  };

  for (const movie of movies) {
    push(movieByTmdbId, movie.tmdbId, movie);
    if (movie.imdbId) push(movieByImdbId, movie.imdbId.toLowerCase(), movie);
    push(movieByTitleYear, normalizeTitleKey(movie.title, movie.year ?? null), movie);
  }

  for (const show of series) {
    if (show.tvdbId) push(seriesByTvdbId, show.tvdbId, show);
    if (show.imdbId) push(seriesByImdbId, show.imdbId.toLowerCase(), show);
    const tmdbId = (show as SonarrSeries & { tmdbId?: number }).tmdbId;
    if (tmdbId) push(seriesByTmdbId, tmdbId, show);
    push(seriesByTitleYear, normalizeTitleKey(show.title, show.year ?? null), show);
    push(seriesByBaseTitle, normalizeBaseTitle(show.title), show);
  }

  return {
    movieByTmdbId,
    movieByImdbId,
    movieByTitleYear,
    seriesByTvdbId,
    seriesByImdbId,
    seriesByTmdbId,
    seriesByTitleYear,
    seriesByBaseTitle,
  };
}

// Collapse matches (highest-priority first) into a status: dedupe by instance,
// surface the first as the back-compat top-level + list every holding instance.
function toLibraryStatus(
  type: 'movie' | 'series',
  matches: Array<Tagged<RadarrMovie> | Tagged<SonarrSeries>>
): DiscoverLibraryStatus {
  if (matches.length === 0) return { exists: false };
  const seen = new Set<string>();
  const unique = matches.filter((m) => (seen.has(m.instanceId) ? false : (seen.add(m.instanceId), true)));
  const first = unique[0];
  return {
    exists: true,
    type,
    id: first.id,
    titleSlug: first.titleSlug,
    tmdbId: (first as { tmdbId?: number }).tmdbId,
    instanceId: first.instanceId,
    instances: unique.map((m) => ({
      instanceId: m.instanceId,
      instanceLabel: m.instanceLabel,
      id: m.id,
      titleSlug: m.titleSlug,
    })),
  };
}

// Build a series status from already-resolved library matches (e.g. via the
// AniList↔Sonarr mapping reverse lookup) without re-running title/id matching.
export function seriesLibraryStatusFromMatches(matches: Tagged<SonarrSeries>[]): DiscoverLibraryStatus {
  return toLibraryStatus('series', matches);
}

export function matchMovieInLibrary(
  lookups: LibraryLookups,
  item: { tmdbId?: number; imdbId?: string | null; title: string; year: number | null }
): DiscoverLibraryStatus {
  // Gather across keys in priority order (tmdb → imdb → title/year); toLibraryStatus
  // dedupes by instance so the top-level mirrors the highest-priority match.
  const matches: Tagged<RadarrMovie>[] = [];
  if (item.tmdbId) matches.push(...(lookups.movieByTmdbId.get(item.tmdbId) ?? []));
  if (item.imdbId) matches.push(...(lookups.movieByImdbId.get(item.imdbId.toLowerCase()) ?? []));
  matches.push(...(lookups.movieByTitleYear.get(normalizeTitleKey(item.title, item.year)) ?? []));
  return toLibraryStatus('movie', matches);
}

export function matchSeriesInLibrary(
  lookups: LibraryLookups,
  item: {
    tmdbId?: number;
    tvdbId?: number | null;
    imdbId?: string | null;
    title: string;
    titleRomaji?: string | null;
    titleNative?: string | null;
    year: number | null;
  }
): DiscoverLibraryStatus {
  // Exact-id / exact-title keys: gather across all instances (priority order).
  const exact: Tagged<SonarrSeries>[] = [];
  if (item.tvdbId) exact.push(...(lookups.seriesByTvdbId.get(item.tvdbId) ?? []));
  if (item.imdbId) exact.push(...(lookups.seriesByImdbId.get(item.imdbId.toLowerCase()) ?? []));
  if (item.tmdbId) exact.push(...(lookups.seriesByTmdbId.get(item.tmdbId) ?? []));
  exact.push(...(lookups.seriesByTitleYear.get(normalizeTitleKey(item.title, item.year)) ?? []));
  if (exact.length > 0) return toLibraryStatus('series', exact);

  // Fuzzy fallbacks (best-by-year, single result): base title then substring.
  const byBaseTitle = selectBestSeriesMatch(lookups.seriesByBaseTitle.get(normalizeBaseTitle(item.title)) ?? [], item.year);
  if (byBaseTitle) return toLibraryStatus('series', [byBaseTitle]);

  // Substring contains: IMDb/Sonarr may have one entry (e.g. "Jujutsu Kaisen")
  // while AniList has separate per-season entries (e.g. "Jujutsu Kaisen Season 2").
  // Check if a Sonarr title is contained within any of the AniList title variants.
  const anilistTitles = [item.title, item.titleRomaji, item.titleNative]
    .filter((t): t is string => !!t)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9\u3000-\u9fff\uff00-\uffef]+/g, ' ').trim());

  if (anilistTitles.length > 0) {
    const candidates: Tagged<SonarrSeries>[] = [];
    for (const [sonarrBaseTitle, seriesList] of lookups.seriesByBaseTitle) {
      for (const aniTitle of anilistTitles) {
        if (aniTitle.includes(sonarrBaseTitle)) {
          candidates.push(...seriesList);
          break;
        }
      }
    }
    const bySubstring = selectBestSeriesMatch(candidates, item.year);
    if (bySubstring) return toLibraryStatus('series', [bySubstring]);
  }

  return { exists: false };
}

export function annotateDiscoverItems(
  items: DiscoverItem[],
  movies: Tagged<RadarrMovie>[],
  series: Tagged<SonarrSeries>[]
): DiscoverItem[] {
  if (!movies.length && !series.length) return items;

  const lookups = buildLibraryLookups(movies, series);

  return items.map((item) => {
    if (item.mediaType === 'movie') {
      return {
        ...item,
        library: matchMovieInLibrary(lookups, {
          tmdbId: item.tmdbId,
          title: item.title,
          year: item.year,
        }),
      };
    }

    return {
      ...item,
      library: matchSeriesInLibrary(lookups, {
        tmdbId: item.tmdbId,
        title: item.title,
        year: item.year,
      }),
    };
  });
}

export function dedupeDiscoverItems(items: DiscoverItem[]): DiscoverItem[] {
  const seen = new Set<string>();
  const deduped: DiscoverItem[] = [];

  for (const item of items) {
    const key = `${item.mediaType}:${item.tmdbId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(item);
  }

  return deduped;
}
