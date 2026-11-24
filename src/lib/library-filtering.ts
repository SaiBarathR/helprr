import type { LidarrArtistListItem, RadarrMovieListItem, SonarrSeriesListItem } from '@/types';

type SortDirection = 'asc' | 'desc';
type SortValue = number | string;
type WatchPredicate<T> = (item: T) => boolean;

export interface PreparedLibraryRow<T, TSort extends string = string> {
  item: T;
  key: string;
  searchKey: string;
  sortKeys: Record<TSort, SortValue>;
  facets: RowFacets;
}

/**
 * The tag, quality profile, root folder and genre picks of a library page's filter
 * menu. A pick in a group matches any item with it; the groups (and the status
 * filters) must all match. Tag and profile ids, and root folders, belong to one
 * instance, so they are keyed `${instanceId}:${id}`: tag 3 on one Sonarr is not
 * tag 3 on another. '' in `tags` is "No tags". Genres are names, the same anywhere.
 */
export interface LibraryFacetFilters {
  tags: string[];
  qualityProfiles: string[];
  rootFolders: string[];
  genres: string[];
}

export const LIBRARY_FACET_KEYS = ['tags', 'qualityProfiles', 'rootFolders', 'genres'] as const;
export type LibraryFacetKey = (typeof LIBRARY_FACET_KEYS)[number];

export const EMPTY_LIBRARY_FACETS: LibraryFacetFilters = { tags: [], qualityProfiles: [], rootFolders: [], genres: [] };

interface RowFacets {
  tags: string[];
  qualityProfile: string;
  rootFolder: string;
  genres: string[];
}

interface FacetSource {
  instanceId?: string;
  tags?: number[];
  qualityProfileId?: number;
  path?: string;
  rootFolderPath?: string;
  genres?: string[];
}

export function instanceScopedKey(instanceId: string | undefined, id: number | string): string {
  return `${instanceId ?? ''}:${id}`;
}

function trimSeparators(path: string): string {
  return path.replace(/[\\/]+$/, '');
}

/**
 * The root folder an item's folder sits in. Sonarr and Radarr send it with each
 * item; without it (an older Lidarr) it is the folder above the item's own.
 */
export function rootFolderOf(item: Pick<FacetSource, 'path' | 'rootFolderPath'>): string {
  if (item.rootFolderPath) return trimSeparators(item.rootFolderPath);
  const path = trimSeparators(item.path ?? '');
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return cut > 0 ? path.slice(0, cut) : '';
}

function rowFacets(item: FacetSource): RowFacets {
  return {
    tags: (item.tags ?? []).map((id) => instanceScopedKey(item.instanceId, id)),
    qualityProfile: item.qualityProfileId != null ? instanceScopedKey(item.instanceId, item.qualityProfileId) : '',
    rootFolder: instanceScopedKey(item.instanceId, rootFolderOf(item)),
    genres: item.genres ?? [],
  };
}

export function hasLibraryFacets(facets: LibraryFacetFilters): boolean {
  return LIBRARY_FACET_KEYS.some((key) => facets[key].length > 0);
}

export function matchesLibraryFacets(row: RowFacets, facets: LibraryFacetFilters): boolean {
  if (facets.tags.length > 0
    && !facets.tags.some((key) => (key === '' ? row.tags.length === 0 : row.tags.includes(key)))) return false;
  if (facets.qualityProfiles.length > 0 && !facets.qualityProfiles.includes(row.qualityProfile)) return false;
  if (facets.rootFolders.length > 0 && !facets.rootFolders.includes(row.rootFolder)) return false;
  if (facets.genres.length > 0 && !facets.genres.some((genre) => row.genres.includes(genre))) return false;
  return true;
}

export interface LibraryFacetOption {
  value: string;
  label: string;
  /** The instance it belongs to, named when the library spans several. */
  hint?: string;
}

type LabelledFacetSource = FacetSource & { instanceLabel?: string; qualityProfileName?: string; tagLabels?: string[] };

/**
 * The choices of each facet group: the values the loaded items have, plus any
 * still-picked value none has now, so it can be unpicked. Tag names come from the
 * items' own labels: the list route resolves `tagLabels` in `tags` order and drops
 * only the ids it can't name, so an item with as many labels as ids names each one.
 */
export function libraryFacetOptions(
  items: readonly LabelledFacetSource[],
  picked: LibraryFacetFilters,
): Record<LibraryFacetKey, LibraryFacetOption[]> {
  const multiInstance = new Set(items.map((item) => item.instanceId ?? '')).size > 1;
  const tags = new Map<string, LibraryFacetOption>();
  const profiles = new Map<string, LibraryFacetOption>();
  const roots = new Map<string, LibraryFacetOption>();
  const genres = new Map<string, LibraryFacetOption>();
  let untagged = false;
  for (const item of items) {
    const hint = multiInstance ? item.instanceLabel : undefined;
    const ids = item.tags ?? [];
    if (ids.length === 0) untagged = true;
    const named = item.tagLabels?.length === ids.length ? item.tagLabels : undefined;
    ids.forEach((id, index) => {
      const value = instanceScopedKey(item.instanceId, id);
      const label = named?.[index];
      const known = tags.get(value);
      if (!known || (label && known.label !== label)) tags.set(value, { value, label: label ?? known?.label ?? `Tag ${id}`, hint });
    });
    if (item.qualityProfileId != null) {
      const value = instanceScopedKey(item.instanceId, item.qualityProfileId);
      if (!profiles.has(value) || item.qualityProfileName) {
        profiles.set(value, { value, label: item.qualityProfileName || `Profile ${item.qualityProfileId}`, hint });
      }
    }
    const root = rootFolderOf(item);
    if (root) roots.set(instanceScopedKey(item.instanceId, root), { value: instanceScopedKey(item.instanceId, root), label: root, hint });
    for (const genre of item.genres ?? []) genres.set(genre, { value: genre, label: genre });
  }

  const finish = (found: Map<string, LibraryFacetOption>, chosen: readonly string[], fallback: (value: string) => string) => {
    for (const value of chosen) if (!found.has(value)) found.set(value, { value, label: fallback(value) });
    return [...found.values()].sort((a, b) => a.label.localeCompare(b.label) || (a.hint ?? '').localeCompare(b.hint ?? ''));
  };
  const idOf = (value: string) => value.slice(value.indexOf(':') + 1);
  const tagOptions = finish(tags, picked.tags.filter(Boolean), (value) => `Tag ${idOf(value)}`);
  // "No tags" leads, as torrents' "No tag" does, once some item has a tag to tell it from.
  if ((untagged && tagOptions.length > 0) || picked.tags.includes('')) tagOptions.unshift({ value: '', label: 'No tags' });
  return {
    tags: tagOptions,
    qualityProfiles: finish(profiles, picked.qualityProfiles, (value) => `Profile ${idOf(value)}`),
    rootFolders: finish(roots, picked.rootFolders, idOf),
    genres: finish(genres, picked.genres, (value) => value),
  };
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

export const MOVIE_SORT_KEYS = [
  'title',
  'originalTitle',
  'year',
  'dateAdded',
  'imdbRating',
  'tmdbRating',
  'tomatoRating',
  'traktRating',
  'popularity',
  'sizeOnDisk',
  'runtime',
  'inCinemas',
  'digitalRelease',
  'physicalRelease',
  'studio',
  'qualityProfile',
  'monitored',
  'path',
  'certification',
  'originalLanguage',
  'tags',
] as const;
export type MovieSortKey = (typeof MOVIE_SORT_KEYS)[number];

export const MOVIE_FILTERS = [
  'monitored',
  'unmonitored',
  'missing',
  'hasFile',
  'released',
  'inCinemas',
  'announced',
  'cutoffUnmet',
] as const;
export type MovieFilter = (typeof MOVIE_FILTERS)[number];

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
    facets: rowFacets(movie),
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
  // As Radarr's Wanted → Cutoff Unmet: monitored, with a file below the profile's cutoff.
  if (filter === 'cutoffUnmet') return movie.monitored && movie.qualityCutoffNotMet === true;
  return true;
}

export function deriveMovieBaseRows(
  rows: PreparedLibraryRow<RadarrMovieListItem, MovieSortKey>[],
  opts: {
    filter: readonly MovieFilter[];
    facets?: LibraryFacetFilters;
    instanceFilter: string;
    sort: MovieSortKey;
    sortDir: SortDirection;
    watchPredicate?: WatchPredicate<RadarrMovieListItem>;
  },
): PreparedLibraryRow<RadarrMovieListItem, MovieSortKey>[] {
  const filtered = rows.filter(({ item, facets }) => {
    if (opts.filter.length > 0 && !opts.filter.some((f) => matchesMovieFilter(item, f))) return false;
    if (opts.facets && !matchesLibraryFacets(facets, opts.facets)) return false;
    if (opts.instanceFilter !== 'all' && item.instanceId !== opts.instanceFilter) return false;
    if (opts.watchPredicate && !opts.watchPredicate(item)) return false;
    return true;
  });
  return filtered.sort((a, b) => direction(compareValues(a.sortKeys[opts.sort], b.sortKeys[opts.sort]), opts.sortDir));
}

export const SERIES_SORT_KEYS = [
  'title',
  'year',
  'dateAdded',
  'rating',
  'sizeOnDisk',
  'nextAiring',
  'previousAiring',
  'network',
  'runtime',
  'qualityProfile',
  'monitored',
  'originalLanguage',
  'seasons',
  'episodes',
  'episodeCount',
  'path',
  'tags',
] as const;
export type SeriesSortKey = (typeof SERIES_SORT_KEYS)[number];

export const SERIES_FILTERS = [
  'monitored',
  'unmonitored',
  'continuing',
  'ended',
  'missing',
  'upcoming',
  'cutoffUnmet',
] as const;
export type SeriesFilter = (typeof SERIES_FILTERS)[number];

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
    facets: rowFacets(item),
  }));
}

function matchesSeriesFilter(
  row: PreparedLibraryRow<SonarrSeriesListItem, SeriesSortKey>,
  filter: SeriesFilter,
  cutoffUnmetKeys: ReadonlySet<string> | undefined,
): boolean {
  const { item } = row;
  if (filter === 'monitored') return item.monitored;
  if (filter === 'unmonitored') return !item.monitored;
  if (filter === 'continuing') return item.status === 'continuing';
  if (filter === 'ended') return item.status === 'ended';
  if (filter === 'missing') return item.monitored && item.statistics.episodeCount < item.statistics.totalEpisodeCount;
  if (filter === 'upcoming') return item.status === 'upcoming';
  // A series has no cutoff state of its own; the keys come from Sonarr's Wanted → Cutoff Unmet.
  if (filter === 'cutoffUnmet') return cutoffUnmetKeys?.has(row.key) ?? false;
  return true;
}

export function deriveSeriesBaseRows(
  rows: PreparedLibraryRow<SonarrSeriesListItem, SeriesSortKey>[],
  opts: {
    filter: readonly SeriesFilter[];
    facets?: LibraryFacetFilters;
    /** Row keys of the series on Wanted → Cutoff Unmet; until they load, that filter matches none. */
    cutoffUnmetKeys?: ReadonlySet<string>;
    instanceFilter: string;
    sort: SeriesSortKey;
    sortDir: SortDirection;
    watchPredicate?: WatchPredicate<SonarrSeriesListItem>;
  },
): PreparedLibraryRow<SonarrSeriesListItem, SeriesSortKey>[] {
  const filtered = rows.filter((row) => {
    const { item } = row;
    if (opts.filter.length > 0 && !opts.filter.some((f) => matchesSeriesFilter(row, f, opts.cutoffUnmetKeys))) return false;
    if (opts.facets && !matchesLibraryFacets(row.facets, opts.facets)) return false;
    if (opts.instanceFilter !== 'all' && item.instanceId !== opts.instanceFilter) return false;
    if (opts.watchPredicate && !opts.watchPredicate(item)) return false;
    return true;
  });
  return filtered.sort((a, b) => direction(compareValues(a.sortKeys[opts.sort], b.sortKeys[opts.sort]), opts.sortDir));
}

export const MUSIC_SORT_KEYS = [
  'sortName',
  'dateAdded',
  'albumCount',
  'trackCount',
  'sizeOnDisk',
  'rating',
  'qualityProfile',
  'monitored',
  'artistType',
  'path',
] as const;
export type MusicSortKey = (typeof MUSIC_SORT_KEYS)[number];

export const MUSIC_FILTERS = [
  'monitored',
  'unmonitored',
  'missing',
  'complete',
  'continuing',
  'ended',
] as const;
export type MusicFilter = (typeof MUSIC_FILTERS)[number];

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
    facets: rowFacets(artist),
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
    facets?: LibraryFacetFilters;
    instanceFilter: string;
    sort: MusicSortKey;
    sortDir: SortDirection;
  },
): PreparedLibraryRow<LidarrArtistListItem, MusicSortKey>[] {
  const filtered = rows.filter(({ item, facets }) => {
    if (opts.filter.length > 0 && !opts.filter.some((f) => matchesMusicFilter(item, f))) return false;
    if (opts.facets && !matchesLibraryFacets(facets, opts.facets)) return false;
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
