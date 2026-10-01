import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState } from '@/lib/store';
import type { DiscoverContentType, DiscoverFiltersResponse } from '@/types';

/** Everything that decides what Discover shows. */
export interface DiscoverView {
  contentType: DiscoverContentType;
  sort: string;
  sortDirection: 'asc' | 'desc';
  filters: DiscoverFiltersState;
  section: string | null;
  manualBrowseMode: boolean;
  person: { id: number; name: string } | null;
  /** Display names a link passed for ids the filter metadata can't name. */
  names: Record<string, string>;
}

export const SECTION_TO_BROWSE: Record<string, { sort: string; contentType: DiscoverContentType }> = {
  trending: { sort: 'trending', contentType: 'all' },
  popular_movies: { sort: 'popular', contentType: 'movie' },
  popular_series: { sort: 'popular', contentType: 'show' },
  upcoming_movies: { sort: 'upcoming', contentType: 'movie' },
  upcoming_series: { sort: 'upcoming', contentType: 'show' },
  now_playing: { sort: 'popular', contentType: 'movie' },
  airing_today: { sort: 'popular', contentType: 'show' },
  top_rated_movies: { sort: 'highlyRated', contentType: 'movie' },
  top_rated_tv: { sort: 'highlyRated', contentType: 'show' },
};

const RELEASE_STATES: ReadonlyArray<DiscoverFiltersState['releaseState']> = [
  '', 'released', 'upcoming', 'airing', 'ended',
];

const FILTER_PARAMS = [
  'companies', 'networks', 'genres', 'providers', 'yearFrom', 'yearTo', 'runtimeMin', 'runtimeMax',
  'ratingMin', 'ratingMax', 'voteCountMin', 'language', 'region', 'releaseState',
] as const;

export function toReleaseState(value: string | null | undefined): DiscoverFiltersState['releaseState'] {
  return RELEASE_STATES.find((state) => state === value) ?? '';
}

function parseIds(raw: string | null): number[] {
  return raw
    ? raw.split(',').map((v) => Number(v.trim())).filter((v) => Number.isFinite(v) && v > 0)
    : [];
}

/**
 * The view a Discover link asks for — cast links (`?person=`), widget "View all"
 * links (`?section=` or a full filter set) and genre/provider/network/company
 * chips — or null for a plain visit. A link view starts from Discover's
 * defaults rather than the saved filters, and is never written to them.
 */
export function discoverLinkView(params: URLSearchParams): DiscoverView | null {
  const personId = Number(params.get('person'));
  const personName = params.get('personName')?.trim() || '';
  const person = Number.isFinite(personId) && personId > 0 && personName
    ? { id: personId, name: personName }
    : null;
  const section = params.get('section');
  const sortBy = params.get('sortBy');
  const sortOrder = params.get('sortOrder');
  const hasFilterParam = FILTER_PARAMS.some((key) => params.get(key));
  if (!person && !hasFilterParam && !section && !sortBy) return null;

  const view: DiscoverView = {
    contentType: person ? 'movie' : 'all',
    sort: 'popular',
    sortDirection: 'desc',
    filters: { ...DEFAULT_DISCOVER_FILTERS },
    section: null,
    manualBrowseMode: true,
    person,
    names: {},
  };
  if (!hasFilterParam && !section && !sortBy) return view;

  const rawContentType = params.get('contentType');
  const contentType = rawContentType === 'movie' || rawContentType === 'show' ? rawContentType : 'all';
  const mapped = section ? SECTION_TO_BROWSE[section] : undefined;
  view.section = section;
  if (mapped) {
    view.sort = mapped.sort;
    view.contentType = mapped.contentType;
    view.sortDirection = mapped.sort === 'upcoming' ? 'asc' : 'desc';
  } else {
    view.contentType = contentType;
    if (sortBy) view.sort = sortBy;
    if (sortOrder === 'asc' || sortOrder === 'desc') view.sortDirection = sortOrder;
  }

  if (hasFilterParam) {
    view.filters = {
      ...view.filters,
      companies: parseIds(params.get('companies')),
      networks: parseIds(params.get('networks')),
      genres: parseIds(params.get('genres')),
      providers: parseIds(params.get('providers')),
      yearFrom: params.get('yearFrom') ?? '',
      yearTo: params.get('yearTo') ?? '',
      runtimeMin: params.get('runtimeMin') ?? '',
      runtimeMax: params.get('runtimeMax') ?? '',
      ratingMin: params.get('ratingMin') ?? '',
      ratingMax: params.get('ratingMax') ?? '',
      voteCountMin: params.get('voteCountMin') ?? '',
      language: params.get('language') ?? '',
      region: params.get('region') ?? DEFAULT_DISCOVER_FILTERS.region,
      releaseState: toReleaseState(params.get('releaseState')),
    };
    // Detail pages link a single studio or network and pass its name, which
    // the filter metadata doesn't have for studios.
    const companyName = params.get('companyName')?.trim();
    if (companyName && view.filters.companies.length === 1) {
      view.names[`company:${view.filters.companies[0]}`] = companyName;
    }
    const networkName = params.get('networkName')?.trim();
    if (networkName && view.filters.networks.length === 1) {
      view.names[`network:${view.filters.networks[0]}`] = networkName;
    }
  }
  return view;
}

export interface DiscoverFilterChip {
  id: string;
  label: string;
  /** The change to the view that removes this filter. */
  patch: Partial<DiscoverView>;
}

function rangeLabel(min: string, max: string, unit = '') {
  if (min && max) return `${min}–${max}${unit}`;
  return min ? `${min}+${unit}` : `≤ ${max}${unit}`;
}

/**
 * One chip per filter that hides results. Sort order and the section or person
 * being browsed aren't filters; the grid header names those.
 */
export function discoverFilterChips(view: DiscoverView, meta: DiscoverFiltersResponse | null): DiscoverFilterChip[] {
  const f = view.filters;
  const chips: DiscoverFilterChip[] = [];
  const withFilters = (next: Partial<DiscoverFiltersState>) => ({ filters: { ...f, ...next } });
  const mediaType = view.contentType === 'movie' ? 'movie' : view.contentType === 'show' ? 'tv' : null;
  const nameOf = <T extends { id: number; name: string; type?: string }>(list: T[] | undefined, id: number) =>
    (list ?? []).find((item) => item.id === id && (!mediaType || !item.type || item.type === mediaType))?.name
    ?? (list ?? []).find((item) => item.id === id)?.name;

  // A section decides its own content type (the API overrides it), so there
  // it isn't a removable filter; the grid header names the section instead.
  if (view.contentType !== 'all' && !view.section) {
    chips.push({ id: 'contentType', label: view.contentType === 'movie' ? 'Movies' : 'Shows', patch: { contentType: 'all' } });
  }
  for (const id of f.genres) {
    chips.push({ id: `genre:${id}`, label: nameOf(meta?.genres, id) ?? 'Genre', patch: withFilters({ genres: f.genres.filter((g) => g !== id) }) });
  }
  for (const id of f.providers) {
    chips.push({ id: `provider:${id}`, label: nameOf(meta?.providers, id) ?? 'Provider', patch: withFilters({ providers: f.providers.filter((p) => p !== id) }) });
  }
  for (const id of f.networks) {
    chips.push({
      id: `network:${id}`,
      label: view.names[`network:${id}`] ?? nameOf(meta?.networks, id) ?? 'Network',
      patch: withFilters({ networks: f.networks.filter((n) => n !== id) }),
    });
  }
  for (const id of f.companies) {
    chips.push({ id: `company:${id}`, label: view.names[`company:${id}`] ?? 'Studio', patch: withFilters({ companies: f.companies.filter((c) => c !== id) }) });
  }
  if (f.yearFrom || f.yearTo) {
    chips.push({
      id: 'year',
      label: rangeLabel(f.yearFrom, f.yearTo),
      patch: withFilters({ yearFrom: '', yearTo: '' }),
    });
  }
  if (f.runtimeMin || f.runtimeMax) {
    chips.push({
      id: 'runtime',
      label: rangeLabel(f.runtimeMin, f.runtimeMax, ' min'),
      patch: withFilters({ runtimeMin: '', runtimeMax: '' }),
    });
  }
  if (f.ratingMin || f.ratingMax) {
    chips.push({
      id: 'rating',
      label: `Rated ${rangeLabel(f.ratingMin, f.ratingMax)}`,
      patch: withFilters({ ratingMin: '', ratingMax: '' }),
    });
  }
  if (f.voteCountMin) {
    chips.push({ id: 'votes', label: `${f.voteCountMin}+ votes`, patch: withFilters({ voteCountMin: '' }) });
  }
  if (f.language) {
    const name = meta?.languages.find((l) => l.code === f.language)?.name ?? f.language.toUpperCase();
    chips.push({ id: 'language', label: name, patch: withFilters({ language: '' }) });
  }
  if (f.region && f.region !== DEFAULT_DISCOVER_FILTERS.region) {
    const name = meta?.regions.find((r) => r.code === f.region)?.name ?? f.region;
    chips.push({ id: 'region', label: `Region: ${name}`, patch: withFilters({ region: DEFAULT_DISCOVER_FILTERS.region }) });
  }
  if (f.releaseState) {
    const label = meta?.releaseStates.find((s) => s.value === f.releaseState)?.label
      ?? f.releaseState.charAt(0).toUpperCase() + f.releaseState.slice(1);
    chips.push({ id: 'releaseState', label, patch: withFilters({ releaseState: '' }) });
  }
  return chips;
}
