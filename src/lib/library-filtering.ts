import type { LidarrArtistListItem, RadarrMovieListItem, SonarrSeriesListItem } from '@/types';

type SortDirection = 'asc' | 'desc';
type SortValue = number | string;
type WatchPredicate<T> = (item: T) => boolean;

export interface PreparedLibraryRow<T, TSort extends string = string> {
  item: T;
  key: string;
  searchKey: string;
  sortKeys: Record<TSort, SortValue>;
}

function timestamp(value: string | null | undefined, fallback = 0): number {
  if (!value) return fallback;
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? ms : fallback;
}

function joinedTags(labels: string[] | undefined): string {
  return labels ? [...labels].sort().join(',') : '';
}

function compareValues(a: SortValue, b: SortValue): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b));
}

function direction(result: number, sortDir: SortDirection): number {
  return sortDir === 'asc' ? result : -result;
}

export type MovieSortKey =
  | 'title'
  | 'originalTitle'
  | 'year'
  | 'dateAdded'
  | 'imdbRating'
  | 'tmdbRating'
  | 'tomatoRating'
  | 'traktRating'
  | 'popularity'
  | 'sizeOnDisk'
  | 'runtime'
  | 'inCinemas'
  | 'digitalRelease'
  | 'physicalRelease'
  | 'studio'
  | 'qualityProfile'
  | 'monitored'
  | 'path'
  | 'certification'
  | 'originalLanguage'
  | 'tags';

export type MovieFilter =
  | 'monitored'
  | 'unmonitored'
  | 'missing'
  | 'hasFile'
  | 'released'
  | 'inCinemas'
  | 'announced';

export function prepareMovieRows(movies: RadarrMovieListItem[]): PreparedLibraryRow<RadarrMovieListItem, MovieSortKey>[] {
  return movies.map((movie) => ({
    item: movie,
    key: `${movie.instanceId ?? ''}:${movie.id}`,
    searchKey: movie.title.toLowerCase(),
    sortKeys: {
      title: movie.sortTitle,
      originalTitle: movie.originalTitle || movie.title,
      year: movie.year,
      dateAdded: timestamp(movie.added),
      imdbRating: movie.ratings?.imdb?.value || 0,
      tmdbRating: movie.ratings?.tmdb?.value || 0,
      tomatoRating: movie.ratings?.rottenTomatoes?.value || 0,
      traktRating: movie.ratings?.trakt?.value || 0,
      popularity: movie.popularity || 0,
      sizeOnDisk: movie.sizeOnDisk,
      runtime: movie.runtime,
      inCinemas: timestamp(movie.inCinemas),
      digitalRelease: timestamp(movie.digitalRelease),
      physicalRelease: timestamp(movie.physicalRelease),
      studio: movie.studio || '',
      qualityProfile: movie.qualityProfileName || '',
      monitored: movie.monitored ? 0 : 1,
      path: movie.path || '',
      certification: movie.certification || '',
      originalLanguage: movie.originalLanguage?.name || '',
      tags: joinedTags(movie.tagLabels),
    },
  }));
}

function matchesMovieFilter(movie: RadarrMovieListItem, filter: MovieFilter): boolean {
  if (filter === 'monitored') return movie.monitored;
  if (filter === 'unmonitored') return !movie.monitored;
  if (filter === 'missing') return movie.monitored && !movie.hasFile;
  if (filter === 'hasFile') return movie.hasFile;
  if (filter === 'released') return movie.status === 'released';
  if (filter === 'inCinemas') return movie.status === 'inCinemas';
  if (filter === 'announced') return movie.status === 'announced';
  return true;
}

export function deriveMovieBaseRows(
  rows: PreparedLibraryRow<RadarrMovieListItem, MovieSortKey>[],
  opts: {
    filter: readonly MovieFilter[];
    instanceFilter: string;
    sort: MovieSortKey;
    sortDir: SortDirection;
    watchPredicate?: WatchPredicate<RadarrMovieListItem>;
  },
): PreparedLibraryRow<RadarrMovieListItem, MovieSortKey>[] {
  const filtered = rows.filter(({ item }) => {
    if (opts.filter.length > 0 && !opts.filter.some((f) => matchesMovieFilter(item, f))) return false;
    if (opts.instanceFilter !== 'all' && item.instanceId !== opts.instanceFilter) return false;
    if (opts.watchPredicate && !opts.watchPredicate(item)) return false;
    return true;
  });
  return filtered.sort((a, b) => direction(compareValues(a.sortKeys[opts.sort], b.sortKeys[opts.sort]), opts.sortDir));
}

export type SeriesSortKey =
  | 'title'
  | 'year'
  | 'dateAdded'
  | 'rating'
  | 'sizeOnDisk'
  | 'nextAiring'
  | 'previousAiring'
  | 'network'
  | 'runtime'
  | 'qualityProfile'
  | 'monitored'
  | 'originalLanguage'
  | 'seasons'
  | 'episodes'
  | 'episodeCount'
  | 'path'
  | 'tags';

export type SeriesFilter = 'monitored' | 'unmonitored' | 'continuing' | 'ended' | 'missing' | 'upcoming';

export function prepareSeriesRows(series: SonarrSeriesListItem[]): PreparedLibraryRow<SonarrSeriesListItem, SeriesSortKey>[] {
  return series.map((item) => ({
    item,
    key: `${item.instanceId ?? ''}:${item.id}`,
    searchKey: item.title.toLowerCase(),
    sortKeys: {
      title: item.sortTitle,
      year: item.year,
      dateAdded: timestamp(item.added),
      rating: item.ratings?.value || 0,
      sizeOnDisk: item.statistics.sizeOnDisk,
      nextAiring: timestamp(item.nextAiring, timestamp('9999')),
      previousAiring: timestamp(item.previousAiring),
      network: item.network || '',
      runtime: item.runtime,
      qualityProfile: item.qualityProfileName || '',
      monitored: item.monitored ? 0 : 1,
      originalLanguage: item.originalLanguage?.name || '',
      seasons: item.statistics.seasonCount,
      episodes: item.statistics.episodeCount,
      episodeCount: item.statistics.totalEpisodeCount,
      path: item.path || '',
      tags: joinedTags(item.tagLabels),
    },
  }));
}

function matchesSeriesFilter(item: SonarrSeriesListItem, filter: SeriesFilter): boolean {
  if (filter === 'monitored') return item.monitored;
  if (filter === 'unmonitored') return !item.monitored;
  if (filter === 'continuing') return item.status === 'continuing';
  if (filter === 'ended') return item.status === 'ended';
  if (filter === 'missing') return item.monitored && item.statistics.episodeCount < item.statistics.totalEpisodeCount;
  if (filter === 'upcoming') return item.status === 'upcoming';
  return true;
}

export function deriveSeriesBaseRows(
  rows: PreparedLibraryRow<SonarrSeriesListItem, SeriesSortKey>[],
  opts: {
    filter: readonly SeriesFilter[];
    instanceFilter: string;
    sort: SeriesSortKey;
    sortDir: SortDirection;
    watchPredicate?: WatchPredicate<SonarrSeriesListItem>;
  },
): PreparedLibraryRow<SonarrSeriesListItem, SeriesSortKey>[] {
  const filtered = rows.filter(({ item }) => {
    if (opts.filter.length > 0 && !opts.filter.some((f) => matchesSeriesFilter(item, f))) return false;
    if (opts.instanceFilter !== 'all' && item.instanceId !== opts.instanceFilter) return false;
    if (opts.watchPredicate && !opts.watchPredicate(item)) return false;
    return true;
  });
  return filtered.sort((a, b) => direction(compareValues(a.sortKeys[opts.sort], b.sortKeys[opts.sort]), opts.sortDir));
}

export type MusicSortKey =
  | 'sortName'
  | 'dateAdded'
  | 'albumCount'
  | 'trackCount'
  | 'sizeOnDisk'
  | 'rating'
  | 'qualityProfile'
  | 'monitored'
  | 'artistType'
  | 'path';

export type MusicFilter = 'monitored' | 'unmonitored' | 'missing' | 'complete' | 'continuing' | 'ended';

export function prepareMusicRows(artists: LidarrArtistListItem[]): PreparedLibraryRow<LidarrArtistListItem, MusicSortKey>[] {
  return artists.map((artist) => ({
    item: artist,
    key: `${artist.instanceId ?? ''}:${artist.id}`,
    searchKey: artist.artistName.toLowerCase(),
    sortKeys: {
      sortName: artist.sortName || artist.artistName,
      dateAdded: timestamp(artist.added),
      albumCount: artist.statistics?.albumCount || 0,
      trackCount: artist.statistics?.totalTrackCount || 0,
      sizeOnDisk: artist.statistics?.sizeOnDisk || 0,
      rating: artist.ratings?.value || 0,
      qualityProfile: artist.qualityProfileName || '',
      monitored: artist.monitored ? 0 : 1,
      artistType: artist.artistType || '',
      path: artist.path || '',
    },
  }));
}

function matchesMusicFilter(artist: LidarrArtistListItem, filter: MusicFilter): boolean {
  const stats = artist.statistics;
  if (filter === 'monitored') return artist.monitored;
  if (filter === 'unmonitored') return !artist.monitored;
  if (filter === 'missing') return !!stats && stats.trackFileCount < stats.totalTrackCount;
  if (filter === 'complete') return !!stats && stats.totalTrackCount > 0 && stats.trackFileCount >= stats.totalTrackCount;
  if (filter === 'continuing') return artist.status === 'continuing';
  if (filter === 'ended') return artist.status === 'ended' || artist.ended;
  return true;
}

export function deriveMusicBaseRows(
  rows: PreparedLibraryRow<LidarrArtistListItem, MusicSortKey>[],
  opts: {
    filter: readonly MusicFilter[];
    instanceFilter: string;
    sort: MusicSortKey;
    sortDir: SortDirection;
  },
): PreparedLibraryRow<LidarrArtistListItem, MusicSortKey>[] {
  const filtered = rows.filter(({ item }) => {
    if (opts.filter.length > 0 && !opts.filter.some((f) => matchesMusicFilter(item, f))) return false;
    if (opts.instanceFilter !== 'all' && item.instanceId !== opts.instanceFilter) return false;
    return true;
  });
  return filtered.sort((a, b) => direction(compareValues(a.sortKeys[opts.sort], b.sortKeys[opts.sort]), opts.sortDir));
}

export function searchPreparedRows<T, TSort extends string>(
  rows: PreparedLibraryRow<T, TSort>[],
  search: string,
): PreparedLibraryRow<T, TSort>[] {
  const query = search.trim().toLowerCase();
  return query ? rows.filter((row) => row.searchKey.includes(query)) : rows;
}

export function preparedItems<T, TSort extends string>(rows: PreparedLibraryRow<T, TSort>[]): T[] {
  return rows.map((row) => row.item);
}
