import { ChevronRight, Flame, Heart, Sparkles, Star } from 'lucide-react';
import { ApiError } from '@/lib/query-fetch';
import { DEFAULT_DISCOVER_FILTERS, type DiscoverFiltersState, useUIStore } from '@/lib/store';
import type { DiscoverLayoutCustomFilters } from '@/lib/discover-layout-config';

export const SORT_OPTIONS = [
  { value: 'trending', label: 'Trending', icon: Flame },
  { value: 'highlyRated', label: 'Highly Rated', icon: Star },
  { value: 'mostLoved', label: 'Most Loved', icon: Heart },
  { value: 'popular', label: 'Popular', icon: Sparkles },
  { value: 'upcoming', label: 'Upcoming', icon: ChevronRight },
] as const;

export interface RateLimitInfo {
  message: string;
  retryAfterSeconds: number | null;
  retryAt: string | null;
}

// Discover fetches proxy TMDB, which is rate-limited; a 429 (or a 200 carrying
// code:'TMDB_RATE_LIMIT') must surface the rate-limit banner rather than an error
// screen. discoverFetch throws a typed RateLimitError on that case (read in
// render to drive the banner) and an ApiError on any other !ok (so the global
// 401 handler still redirects). Queries set retry:false so a 429 isn't re-hit.
export class RateLimitError extends Error {
  constructor(public payload: unknown) {
    super('TMDB_RATE_LIMIT');
    this.name = 'RateLimitError';
  }
}

export async function discoverFetch<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // non-JSON body (e.g. a 500 HTML page) — fall through to the !ok throw
  }
  if (res.status === 429 || (data as { code?: string } | null)?.code === 'TMDB_RATE_LIMIT') {
    throw new RateLimitError(data);
  }
  if (!res.ok) throw new ApiError(res.status, `GET ${url} → ${res.status}`);
  return data as T;
}

export function buildCustomCarouselParams(f: DiscoverLayoutCustomFilters, limit: number): URLSearchParams {
  const params = new URLSearchParams();
  params.set('mode', 'browse');
  params.set('page', '1');
  params.set('limit', String(limit));
  params.set('contentType', f.contentType);
  params.set('sortBy', f.sortBy);
  params.set('sortOrder', f.sortOrder);
  if (f.genres?.length) params.set('genres', f.genres.join(','));
  if (f.yearFrom) params.set('yearFrom', f.yearFrom);
  if (f.yearTo) params.set('yearTo', f.yearTo);
  if (f.runtimeMin) params.set('runtimeMin', f.runtimeMin);
  if (f.runtimeMax) params.set('runtimeMax', f.runtimeMax);
  if (f.ratingMin) params.set('ratingMin', f.ratingMin);
  if (f.ratingMax) params.set('ratingMax', f.ratingMax);
  if (f.voteCountMin) params.set('voteCountMin', f.voteCountMin);
  if (f.language) params.set('language', f.language);
  if (f.region) params.set('region', f.region);
  if (f.providers?.length) params.set('providers', f.providers.join(','));
  if (f.networks?.length) params.set('networks', f.networks.join(','));
  if (f.companies?.length) params.set('companies', f.companies.join(','));
  if (f.releaseState) params.set('releaseState', f.releaseState);
  return params;
}

function parsePositiveInt(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : undefined;
}

function parsePositiveFloat(value: string) {
  const normalized = value.trim();
  if (!normalized) return undefined;
  const n = Number(normalized);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

export function normalizeFilterValues(filters: DiscoverFiltersState): DiscoverFiltersState {
  return {
    ...filters,
    yearFrom: parsePositiveInt(filters.yearFrom)?.toString() || '',
    yearTo: parsePositiveInt(filters.yearTo)?.toString() || '',
    runtimeMin: parsePositiveInt(filters.runtimeMin)?.toString() || '',
    runtimeMax: parsePositiveInt(filters.runtimeMax)?.toString() || '',
    ratingMin: parsePositiveFloat(filters.ratingMin)?.toString() || '',
    ratingMax: parsePositiveFloat(filters.ratingMax)?.toString() || '',
    voteCountMin: parsePositiveInt(filters.voteCountMin)?.toString() || '',
    language: filters.language.trim().toLowerCase(),
    region: (filters.region || DEFAULT_DISCOVER_FILTERS.region).trim().toUpperCase().slice(0, 2),
  };
}

export function isDefaultFilters(filters: ReturnType<typeof useUIStore.getState>['discoverFilters']) {
  const hasSameNumberSet = (a: number[] | undefined, b: number[] | undefined) => {
    const aa = a ?? [];
    const bb = b ?? [];
    if (aa.length !== bb.length) return false;
    const uniqueA = new Set(aa);
    const uniqueB = new Set(bb);
    if (uniqueA.size !== uniqueB.size) return false;
    for (const value of uniqueA) {
      if (!uniqueB.has(value)) return false;
    }
    return true;
  };

  return filters.genres.length === DEFAULT_DISCOVER_FILTERS.genres.length
    && hasSameNumberSet(filters.genres, DEFAULT_DISCOVER_FILTERS.genres)
    && filters.yearFrom === DEFAULT_DISCOVER_FILTERS.yearFrom
    && filters.yearTo === DEFAULT_DISCOVER_FILTERS.yearTo
    && filters.runtimeMin === DEFAULT_DISCOVER_FILTERS.runtimeMin
    && filters.runtimeMax === DEFAULT_DISCOVER_FILTERS.runtimeMax
    && filters.language === DEFAULT_DISCOVER_FILTERS.language
    && (!filters.region || filters.region === DEFAULT_DISCOVER_FILTERS.region)
    && filters.ratingMin === DEFAULT_DISCOVER_FILTERS.ratingMin
    && filters.ratingMax === DEFAULT_DISCOVER_FILTERS.ratingMax
    && filters.voteCountMin === DEFAULT_DISCOVER_FILTERS.voteCountMin
    && hasSameNumberSet(filters.providers, DEFAULT_DISCOVER_FILTERS.providers)
    && hasSameNumberSet(filters.networks, DEFAULT_DISCOVER_FILTERS.networks)
    && hasSameNumberSet(filters.companies, DEFAULT_DISCOVER_FILTERS.companies)
    && filters.releaseState === DEFAULT_DISCOVER_FILTERS.releaseState;
}

export function formatWait(seconds: number) {
  const clamped = Math.max(0, Math.floor(seconds));
  const mins = Math.floor(clamped / 60);
  const secs = clamped % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export function countActiveAdvancedFilters(filters: DiscoverFiltersState): number {
  let count = 0;
  if (filters.genres.length > 0) count += 1;
  if (filters.yearFrom || filters.yearTo) count += 1;
  if (filters.runtimeMin || filters.runtimeMax) count += 1;
  if (filters.ratingMin || filters.ratingMax) count += 1;
  if (filters.voteCountMin) count += 1;
  if (filters.language) count += 1;
  if (filters.region && filters.region !== DEFAULT_DISCOVER_FILTERS.region) count += 1;
  if (filters.providers.length > 0) count += 1;
  if (filters.networks.length > 0) count += 1;
  if (filters.companies.length > 0) count += 1;
  if (filters.releaseState) count += 1;
  return count;
}

// Carousel item count scales with viewport so mobile doesn't pay for items
// it'll never scroll past, and wide displays still have enough to scroll.
// Card widths here mirror the MediaPoster rail-variant breakpoints + 10px gap.
export function computeCarouselItemLimit(): number {
  if (typeof window === 'undefined') return 24;
  const w = window.innerWidth;
  let cardWidth: number;
  if (w >= 1536) cardWidth = 206;
  else if (w >= 1280) cardWidth = 190;
  else if (w >= 1024) cardWidth = 174;
  else if (w >= 768) cardWidth = 160;
  else if (w >= 640) cardWidth = 150;
  else cardWidth = 120;
  const visible = Math.max(1, Math.floor(w / cardWidth));
  return Math.min(46, Math.max(16, Math.ceil(visible * 2.5)));
}
