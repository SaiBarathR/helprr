// Shared by the Prowlarr search route and its tab, so the server keeps the
// same rows the browser's sort then shows.

/** Prowlarr's search types (its `type` parameter), the only ones sent. */
export const PROWLARR_SEARCH_TYPES = [
  { id: 'search', label: 'Any' },
  { id: 'tvsearch', label: 'TV' },
  { id: 'movie', label: 'Movie' },
  { id: 'music', label: 'Music' },
  { id: 'book', label: 'Book' },
] as const;

export type ProwlarrSearchType = (typeof PROWLARR_SEARCH_TYPES)[number]['id'];

export type ProwlarrSearchIdField = 'tvdbId' | 'imdbId' | 'tmdbId' | 'season' | 'episode';

/**
 * The ID fields each type takes, and the token Prowlarr reads for each in the
 * query (NewznabRequest.QueryToParams: `{TvdbId:…}` for tvsearch only, and so
 * on). Music and book have tokens too, but for names, not ids.
 */
export const PROWLARR_SEARCH_ID_FIELDS: Record<ProwlarrSearchType, readonly ProwlarrSearchIdField[]> = {
  search: [],
  tvsearch: ['tvdbId', 'imdbId', 'tmdbId', 'season', 'episode'],
  movie: ['imdbId', 'tmdbId'],
  music: [],
  book: [],
};

export const PROWLARR_SEARCH_ID_TOKENS: Record<ProwlarrSearchIdField, string> = {
  tvdbId: 'TvdbId',
  imdbId: 'ImdbId',
  tmdbId: 'TmdbId',
  season: 'Season',
  episode: 'Episode',
};

export const PROWLARR_SEARCH_ID_LABELS: Record<ProwlarrSearchIdField, string> = {
  tvdbId: 'TVDB ID',
  imdbId: 'IMDb ID',
  tmdbId: 'TMDB ID',
  season: 'Season',
  episode: 'Episode',
};

export const PROWLARR_SEARCH_SORTS = [
  { id: 'seeders', label: 'Seeders' },
  { id: 'size', label: 'Size' },
  { id: 'age', label: 'Newest' },
] as const;

export type ProwlarrSearchSort = (typeof PROWLARR_SEARCH_SORTS)[number]['id'];

/** Results shown for one sort. */
export const PROWLARR_RESULTS_PER_SORT = 100;

interface Sortable {
  size?: number | null;
  seeders?: number | null;
  publishDate?: string | null;
}

/** Most seeded, largest or newest first; no seeders (Usenet) counts as none, and no date sorts last. */
export function compareSearchResults(a: Sortable, b: Sortable, sort: ProwlarrSearchSort): number {
  if (sort === 'size') return (b.size ?? 0) - (a.size ?? 0);
  if (sort === 'age') return (Date.parse(b.publishDate ?? '') || 0) - (Date.parse(a.publishDate ?? '') || 0);
  return (b.seeders ?? 0) - (a.seeders ?? 0);
}

/**
 * The best `limit` rows under every sort, in one list (at most three times
 * `limit`). A broad search across many indexers can return thousands of rows;
 * cutting to the most seeded before the user picks Size or Newest would drop
 * the largest and newest releases and every Usenet one. This way each sort
 * shows its own true top rows without searching the indexers again.
 */
export function keepTopForEverySort<T extends Sortable>(rows: T[], limit = PROWLARR_RESULTS_PER_SORT): T[] {
  const kept = new Set<T>();
  for (const { id } of PROWLARR_SEARCH_SORTS) {
    [...rows].sort((a, b) => compareSearchResults(a, b, id)).slice(0, limit).forEach((row) => kept.add(row));
  }
  return rows.filter((row) => kept.has(row));
}
