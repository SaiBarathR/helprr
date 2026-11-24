import { jsonFetcher } from '@/lib/query-fetch';
import type { ProwlarrStats } from '@/lib/prowlarr-client';

export type DateRange = '7d' | '30d' | '90d' | 'all';

/** The Stats tab's filters beyond the range. */
export interface StatsFilters {
  /** The last day counted, as a local `YYYY-MM-DD`; empty for up to now. */
  endDate: string;
  indexers: number[];
  tags: number[];
  protocol: '' | 'torrent' | 'usenet';
}

export const NO_STATS_FILTERS: StatsFilters = { endDate: '', indexers: [], tags: [], protocol: '' };

export function hasStatsFilters(filters: StatsFilters): boolean {
  return !!filters.endDate || filters.indexers.length > 0 || filters.tags.length > 0 || !!filters.protocol;
}

const RANGE_DAYS: Record<Exclude<DateRange, 'all'>, number> = { '7d': 7, '30d': 30, '90d': 90 };

/** The end of a local `YYYY-MM-DD` day, or null for anything else. */
export function endOfLocalDay(day: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]), 23, 59, 59, 999);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * The query string for a range and filters. With an end day the range counts
 * back from the end of that day, so "7d" up to the 10th is the 4th to the 10th;
 * without one it counts back from now.
 */
export function statsSearchParams(range: DateRange, filters: StatsFilters = NO_STATS_FILTERS): URLSearchParams {
  const params = new URLSearchParams();
  const end = filters.endDate ? endOfLocalDay(filters.endDate) : null;
  if (range !== 'all') {
    const start = new Date(end ?? Date.now());
    start.setDate(start.getDate() - RANGE_DAYS[range]);
    params.set('startDate', start.toISOString());
  }
  if (end) params.set('endDate', end.toISOString());
  if (filters.indexers.length) params.set('indexers', filters.indexers.join(','));
  if (filters.tags.length) params.set('tags', filters.tags.join(','));
  if (filters.protocol) params.set('protocols', filters.protocol);
  return params;
}

/**
 * Shared by the Stats tab and the indexer sheet: range and filters live in the
 * key, so changing them refetches, and opening a sheet reuses what is cached.
 * Unfiltered stats keep the key they always had.
 */
export function prowlarrStatsQuery(range: DateRange, filters: StatsFilters = NO_STATS_FILTERS) {
  const filtered = hasStatsFilters(filters);
  return {
    queryKey: filtered ? ['prowlarr', 'stats', range, filters] : ['prowlarr', 'stats', range],
    queryFn: ({ signal }: { signal?: AbortSignal }) => {
      const params = statsSearchParams(range, filters).toString();
      return jsonFetcher<ProwlarrStats>(params ? `/api/prowlarr/stats?${params}` : '/api/prowlarr/stats')({ signal });
    },
    staleTime: 60_000,
  };
}
