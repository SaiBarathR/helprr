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

/** One of Prowlarr's standard categories, with its subcategories (one level, as Prowlarr has them). */
export interface ProwlarrCategory {
  id: number;
  name: string;
  subCategories: { id: number; name: string }[];
}

function isNamedCategory(value: unknown): value is { id: number; name: string; subCategories?: unknown } {
  const record = value as { id?: unknown; name?: unknown } | null;
  return Number.isInteger(record?.id) && typeof record?.name === 'string' && record.name.length > 0;
}

/**
 * Prowlarr's category tree (GET /api/v1/indexer/categories), kept to ids and
 * names. Its list ends with a second "Other" (id 0, subcategories 10 and 20),
 * a placeholder for releases with no category that no indexer is searched by,
 * so that branch is left out.
 */
export function parseProwlarrCategoryTree(raw: unknown): ProwlarrCategory[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isNamedCategory)
    .filter(({ id }) => id > 0)
    .map(({ id, name, subCategories }) => ({
      id,
      name,
      subCategories: (Array.isArray(subCategories) ? subCategories : [])
        .filter(isNamedCategory)
        .map((sub) => ({ id: sub.id, name: sub.name })),
    }));
}

/** Every id in the tree, top-level and sub. */
export function prowlarrCategoryIds(tree: readonly ProwlarrCategory[]): Set<number> {
  return new Set(tree.flatMap(({ id, subCategories }) => [id, ...subCategories.map((sub) => sub.id)]));
}

/** Standard Newznab categories end below 100000; above that are an indexer's own, which Prowlarr sends unnamed. */
const CUSTOM_CATEGORY_START = 100_000;

/**
 * The names to show for a release's categories: the standard ones, most
 * specific first, so "Movies/HD" stands in for "Movies" when both are there.
 */
export function releaseCategoryNames(categories: unknown, limit = 2): string[] {
  if (!Array.isArray(categories)) return [];
  const named = categories.filter(isNamedCategory).filter(({ id }) => id > 0 && id < CUSTOM_CATEGORY_START);
  const ids = new Set(named.map(({ id }) => id));
  const names = named
    // A parent (2000) goes when one of its own subcategories (2001–2999) is there.
    .filter(({ id }) => id % 1000 !== 0 || ![...ids].some((other) => other !== id && Math.floor(other / 1000) * 1000 === id))
    .sort((a, b) => (a.id % 1000 === 0 ? 1 : 0) - (b.id % 1000 === 0 ? 1 : 0))
    .map(({ name }) => name);
  return [...new Set(names)].slice(0, limit);
}

/**
 * The indexer flags shown on a result (Prowlarr's IndexerFlag names). Anything
 * else is dropped. The ratio flags mean nothing on a public tracker, which
 * Prowlarr marks freeleech throughout, so the route leaves those off there.
 */
export const PROWLARR_RELEASE_FLAGS = {
  freeleech: 'Freeleech',
  halfleech: 'Halfleech',
  freeleech25: '25% freeleech',
  freeleech75: '75% freeleech',
  doubleupload: 'Double upload',
  internal: 'Internal',
  exclusive: 'Exclusive',
  scene: 'Scene',
  nuked: 'Nuked',
} as const;

export type ProwlarrReleaseFlag = keyof typeof PROWLARR_RELEASE_FLAGS;

const RATIO_FLAGS: ReadonlySet<ProwlarrReleaseFlag> = new Set(['freeleech', 'halfleech', 'freeleech25', 'freeleech75', 'doubleupload']);

export function releaseFlags(flags: unknown, publicIndexer: boolean): ProwlarrReleaseFlag[] {
  if (!Array.isArray(flags)) return [];
  const known = flags
    .map((flag) => (typeof flag === 'string' ? flag.toLowerCase() : ''))
    .filter((flag): flag is ProwlarrReleaseFlag => Object.hasOwn(PROWLARR_RELEASE_FLAGS, flag))
    .filter((flag) => !(publicIndexer && RATIO_FLAGS.has(flag)));
  return [...new Set(known)];
}
