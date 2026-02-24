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

function asYear(value?: string) {
  if (!value) return null;
  const year = Number(value.slice(0, 4));
  return Number.isFinite(year) ? year : null;
}

type AnimeCandidate = Pick<TmdbListItem, 'genre_ids' | 'original_language' | 'origin_country'>;

export function isJapaneseAnime(item: AnimeCandidate, mediaType: DiscoverMediaType): boolean {
  const genres = item.genre_ids || [];
  if (!genres.includes(16)) return false;

  if (mediaType === 'tv') {
    return (item.origin_country || []).includes('JP');
  }

  return item.original_language === 'ja';
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
    isAnime: isJapaneseAnime(item, mediaType),
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
}

export function buildLibraryLookups(movies: RadarrMovie[], series: SonarrSeries[]): LibraryLookups {
  const movieByTmdbId = new Map<number, RadarrMovie>();
  const movieByImdbId = new Map<string, RadarrMovie>();
  const movieByTitleYear = new Map<string, RadarrMovie>();
  const seriesByTvdbId = new Map<number, SonarrSeries>();
  const seriesByImdbId = new Map<string, SonarrSeries>();
  const seriesByTmdbId = new Map<number, SonarrSeries>();
  const seriesByTitleYear = new Map<string, SonarrSeries>();

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
  }

  return {
    movieByTmdbId,
    movieByImdbId,
    movieByTitleYear,
    seriesByTvdbId,
    seriesByImdbId,
    seriesByTmdbId,
    seriesByTitleYear,
  };
}

export function matchMovieInLibrary(
  lookups: LibraryLookups,
  item: { tmdbId?: number; imdbId?: string | null; title: string; year: number | null }
): DiscoverLibraryStatus {
  if (item.tmdbId && lookups.movieByTmdbId.has(item.tmdbId)) {
    const found = lookups.movieByTmdbId.get(item.tmdbId)!;
    return { exists: true, type: 'movie', id: found.id };
  }

  if (item.imdbId) {
    const byImdb = lookups.movieByImdbId.get(item.imdbId.toLowerCase());
    if (byImdb) return { exists: true, type: 'movie', id: byImdb.id };
  }

  const key = normalizeTitleKey(item.title, item.year);
  const byTitle = lookups.movieByTitleYear.get(key);
  if (byTitle) return { exists: true, type: 'movie', id: byTitle.id };

  return { exists: false };
}

export function matchSeriesInLibrary(
  lookups: LibraryLookups,
  item: {
    tmdbId?: number;
    tvdbId?: number | null;
    imdbId?: string | null;
    title: string;
    year: number | null;
  }
): DiscoverLibraryStatus {
  if (item.tvdbId && lookups.seriesByTvdbId.has(item.tvdbId)) {
    const found = lookups.seriesByTvdbId.get(item.tvdbId)!;
    return { exists: true, type: 'series', id: found.id };
  }

  if (item.imdbId && lookups.seriesByImdbId.has(item.imdbId.toLowerCase())) {
    const found = lookups.seriesByImdbId.get(item.imdbId.toLowerCase())!;
    return { exists: true, type: 'series', id: found.id };
  }

  if (item.tmdbId && lookups.seriesByTmdbId.has(item.tmdbId)) {
    const found = lookups.seriesByTmdbId.get(item.tmdbId)!;
    return { exists: true, type: 'series', id: found.id };
  }

  const key = normalizeTitleKey(item.title, item.year);
  const byTitle = lookups.seriesByTitleYear.get(key);
  if (byTitle) return { exists: true, type: 'series', id: byTitle.id };

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
