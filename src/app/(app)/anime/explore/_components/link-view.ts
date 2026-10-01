import { DEFAULT_ANIME_FILTERS, type AnimeFiltersState } from '@/lib/store';

export interface ExploreView {
  sort: string;
  filters: AnimeFiltersState;
}

const FILTER_PARAMS = ['season', 'year', 'yearMin', 'yearMax', 'status', 'format', 'genres'] as const;

function parseList(raw: string | null): string[] {
  return raw ? raw.split(',').map((value) => value.trim()).filter(Boolean) : [];
}

/**
 * The view an Explore link asks for (the Anime page's and the dashboard's
 * "View all" links), or null for a plain visit. A link view starts from the
 * default filters rather than the saved ones, and is never written to them.
 */
export function exploreLinkView(params: URLSearchParams): ExploreView | null {
  const sort = params.get('sort');
  if (!sort && !FILTER_PARAMS.some((key) => params.get(key))) return null;
  return {
    sort: sort || 'seasonal',
    filters: {
      ...DEFAULT_ANIME_FILTERS,
      season: params.get('season') ?? '',
      year: params.get('year') ?? '',
      yearMin: params.get('yearMin') ?? '',
      yearMax: params.get('yearMax') ?? '',
      status: params.get('status') ?? '',
      formats: parseList(params.get('format')),
      genres: parseList(params.get('genres')),
    },
  };
}

/**
 * The Explore URL for a view and search. A link view is written back so
 * back-navigation and reload return to it, always with `sort` so the URL stays
 * a link after every filter is removed. A plain visit (null) never carries
 * these params: its filters live in the saved store.
 */
export function exploreHref(pathname: string, view: ExploreView | null, search: string): string {
  const params = new URLSearchParams();
  if (view) {
    const { filters } = view;
    params.set('sort', view.sort);
    if (filters.season) params.set('season', filters.season);
    if (filters.year) params.set('year', filters.year);
    if (filters.yearMin) params.set('yearMin', filters.yearMin);
    if (filters.yearMax) params.set('yearMax', filters.yearMax);
    if (filters.status) params.set('status', filters.status);
    if (filters.formats.length) params.set('format', filters.formats.join(','));
    if (filters.genres.length) params.set('genres', filters.genres.join(','));
  }
  if (search) params.set('search', search);
  const query = params.toString();
  return query ? `${pathname}?${query}` : pathname;
}
