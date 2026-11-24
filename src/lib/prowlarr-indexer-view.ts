// The Prowlarr page's indexer list view: its search, sort and filters, kept in
// the UI store like the other pages' list choices. No server imports.

export const PROWLARR_INDEXER_SORTS = ['name', 'priority', 'protocol', 'privacy', 'added'] as const;
export type ProwlarrIndexerSort = (typeof PROWLARR_INDEXER_SORTS)[number];

export const PROWLARR_INDEXER_STATES = ['all', 'enabled', 'disabled'] as const;
export type ProwlarrIndexerState = (typeof PROWLARR_INDEXER_STATES)[number];

export interface ProwlarrIndexerView {
  search: string;
  sort: ProwlarrIndexerSort;
  sortDirection: 'asc' | 'desc';
  state: ProwlarrIndexerState;
  /** Only indexers Prowlarr is failing or has blocked. */
  failing: boolean;
  /** Each list keeps indexers matching any of its values; an empty list keeps all. */
  protocols: string[];
  privacy: string[];
  tags: number[];
  appProfiles: number[];
}

export const DEFAULT_PROWLARR_INDEXER_VIEW: ProwlarrIndexerView = {
  search: '',
  sort: 'name',
  sortDirection: 'asc',
  state: 'all',
  failing: false,
  protocols: [],
  privacy: [],
  tags: [],
  appProfiles: [],
};

/** The direction a sort starts in: newest first for Added, otherwise A–Z and priority 1 first, as in Prowlarr. */
export function defaultIndexerSortDirection(sort: ProwlarrIndexerSort): 'asc' | 'desc' {
  return sort === 'added' ? 'desc' : 'asc';
}

const strings = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : []);
const ids = (value: unknown) => (Array.isArray(value) ? value.filter((entry): entry is number => Number.isSafeInteger(entry) && entry > 0) : []);

/** A stored or imported view made safe to read, or null when it isn't one. Unknown parts fall back to the default. */
export function sanitizeProwlarrIndexerView(value: unknown): ProwlarrIndexerView | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const sort = PROWLARR_INDEXER_SORTS.includes(raw.sort as ProwlarrIndexerSort) ? raw.sort as ProwlarrIndexerSort : DEFAULT_PROWLARR_INDEXER_VIEW.sort;
  return {
    search: typeof raw.search === 'string' ? raw.search : '',
    sort,
    sortDirection: raw.sortDirection === 'asc' || raw.sortDirection === 'desc' ? raw.sortDirection : defaultIndexerSortDirection(sort),
    state: PROWLARR_INDEXER_STATES.includes(raw.state as ProwlarrIndexerState) ? raw.state as ProwlarrIndexerState : 'all',
    failing: raw.failing === true,
    protocols: strings(raw.protocols),
    privacy: strings(raw.privacy),
    tags: ids(raw.tags),
    appProfiles: ids(raw.appProfiles),
  };
}
