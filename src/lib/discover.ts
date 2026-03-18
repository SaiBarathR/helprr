import type {
  DiscoverItem,
  DiscoverMediaType,
  RadarrMovie,
  SonarrSeries,
  DiscoverLibraryStatus,
} from '@/types';
import type { TmdbListItem } from '@/lib/tmdb-client';

const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p';

export function tmdbImageUrl(path: string | null | undefined, size: 'w300' | 'w500' | 'w780' | 'original' = 'w500'): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

function normalizeTitleKey(title: string, year: number | null) {
  const normalized = title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
  return `${normalized}::${year ?? 'na'}`;
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
    backdropPath: tmdbImageUrl(item.backdrop_path, 'w780'),
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

interface LibraryLookups {
  movieByTmdbId: Map<number, RadarrMovie>;
  movieByImdbId: Map<string, RadarrMovie>;
  movieByTitleYear: Map<string, RadarrMovie>;
  seriesByTvdbId: Map<number, SonarrSeries>;
  seriesByImdbId: Map<string, SonarrSeries>;
  seriesByTmdbId: Map<number, SonarrSeries>;
  seriesByTitleYear: Map<string, SonarrSeries>;
  seriesByBaseTitle: Map<string, SonarrSeries[]>;
}

function selectBestSeriesMatch(candidates: SonarrSeries[], year: number | null): SonarrSeries | null {
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

export function buildLibraryLookups(movies: RadarrMovie[], series: SonarrSeries[]): LibraryLookups {
  const movieByTmdbId = new Map<number, RadarrMovie>();
  const movieByImdbId = new Map<string, RadarrMovie>();
  const movieByTitleYear = new Map<string, RadarrMovie>();
  const seriesByTvdbId = new Map<number, SonarrSeries>();
  const seriesByImdbId = new Map<string, SonarrSeries>();
  const seriesByTmdbId = new Map<number, SonarrSeries>();
  const seriesByTitleYear = new Map<string, SonarrSeries>();
  const seriesByBaseTitle = new Map<string, SonarrSeries[]>();

  for (const movie of movies) {
    movieByTmdbId.set(movie.tmdbId, movie);
    if (movie.imdbId) movieByImdbId.set(movie.imdbId.toLowerCase(), movie);
    movieByTitleYear.set(normalizeTitleKey(movie.title, movie.year ?? null), movie);
  }

  for (const show of series) {
    if (show.tvdbId) seriesByTvdbId.set(show.tvdbId, show);
    if (show.imdbId) seriesByImdbId.set(show.imdbId.toLowerCase(), show);
    const tmdbId = (show as SonarrSeries & { tmdbId?: number }).tmdbId;
    if (tmdbId) seriesByTmdbId.set(tmdbId, show);
    seriesByTitleYear.set(normalizeTitleKey(show.title, show.year ?? null), show);
    const baseTitleKey = normalizeBaseTitle(show.title);
    const existing = seriesByBaseTitle.get(baseTitleKey) ?? [];
    existing.push(show);
    seriesByBaseTitle.set(baseTitleKey, existing);
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

export function matchMovieInLibrary(
  lookups: LibraryLookups,
  item: { tmdbId?: number; imdbId?: string | null; title: string; year: number | null }
): DiscoverLibraryStatus {
  if (item.tmdbId && lookups.movieByTmdbId.has(item.tmdbId)) {
    const found = lookups.movieByTmdbId.get(item.tmdbId)!;
    return { exists: true, type: 'movie', id: found.id, titleSlug: found.titleSlug, tmdbId: found.tmdbId };
  }

  if (item.imdbId) {
    const byImdb = lookups.movieByImdbId.get(item.imdbId.toLowerCase());
    if (byImdb) return { exists: true, type: 'movie', id: byImdb.id, titleSlug: byImdb.titleSlug, tmdbId: byImdb.tmdbId };
  }

  const key = normalizeTitleKey(item.title, item.year);
  const byTitle = lookups.movieByTitleYear.get(key);
  if (byTitle) return { exists: true, type: 'movie', id: byTitle.id, titleSlug: byTitle.titleSlug, tmdbId: byTitle.tmdbId };

  return { exists: false };
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
  if (item.tvdbId && lookups.seriesByTvdbId.has(item.tvdbId)) {
    const found = lookups.seriesByTvdbId.get(item.tvdbId)!;
    return { exists: true, type: 'series', id: found.id, titleSlug: found.titleSlug, tmdbId: found.tmdbId ?? undefined };
  }

  if (item.imdbId && lookups.seriesByImdbId.has(item.imdbId.toLowerCase())) {
    const found = lookups.seriesByImdbId.get(item.imdbId.toLowerCase())!;
    return { exists: true, type: 'series', id: found.id, titleSlug: found.titleSlug, tmdbId: found.tmdbId ?? undefined };
  }

  if (item.tmdbId && lookups.seriesByTmdbId.has(item.tmdbId)) {
    const found = lookups.seriesByTmdbId.get(item.tmdbId)!;
    return { exists: true, type: 'series', id: found.id, titleSlug: found.titleSlug, tmdbId: found.tmdbId ?? undefined };
  }

  const key = normalizeTitleKey(item.title, item.year);
  const byTitle = lookups.seriesByTitleYear.get(key);
  if (byTitle) return { exists: true, type: 'series', id: byTitle.id, titleSlug: byTitle.titleSlug, tmdbId: byTitle.tmdbId ?? undefined };

  const baseTitleKey = normalizeBaseTitle(item.title);
  const byBaseTitle = selectBestSeriesMatch(lookups.seriesByBaseTitle.get(baseTitleKey) ?? [], item.year);
  if (byBaseTitle) return { exists: true, type: 'series', id: byBaseTitle.id, titleSlug: byBaseTitle.titleSlug, tmdbId: byBaseTitle.tmdbId ?? undefined };

  // Substring contains: IMDb/Sonarr may have one entry (e.g. "Jujutsu Kaisen")
  // while AniList has separate per-season entries (e.g. "Jujutsu Kaisen Season 2").
  // Check if a Sonarr title is contained within any of the AniList title variants.
  const anilistTitles = [item.title, item.titleRomaji, item.titleNative]
    .filter((t): t is string => !!t)
    .map((t) => t.toLowerCase().replace(/[^a-z0-9\u3000-\u9fff\uff00-\uffef]+/g, ' ').trim());

  if (anilistTitles.length > 0) {
    const candidates: SonarrSeries[] = [];
    for (const [sonarrBaseTitle, seriesList] of lookups.seriesByBaseTitle) {
      for (const aniTitle of anilistTitles) {
        if (aniTitle.includes(sonarrBaseTitle)) {
          candidates.push(...seriesList);
          break;
        }
      }
    }
    const bySubstring = selectBestSeriesMatch(candidates, item.year);
    if (bySubstring) return { exists: true, type: 'series', id: bySubstring.id, titleSlug: bySubstring.titleSlug, tmdbId: bySubstring.tmdbId ?? undefined };
  }

  return { exists: false };
}

export function annotateDiscoverItems(
  items: DiscoverItem[],
  movies: RadarrMovie[],
  series: SonarrSeries[]
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
