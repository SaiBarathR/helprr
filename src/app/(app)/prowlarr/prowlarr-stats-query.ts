import { jsonFetcher } from '@/lib/query-fetch';
import type { ProwlarrStats } from '@/lib/prowlarr-client';

export type DateRange = '7d' | '30d' | '90d' | 'all';

/**
 * Compute the ISO 8601 start date corresponding to a selected date-range option.
 *
 * @param range - One of '7d', '30d', '90d', or 'all'
 * @returns An ISO 8601 date string representing the current date minus the selected number of days, or `undefined` when `range` is `'all'`
 */
function getStartDate(range: DateRange): string | undefined {
  if (range === 'all') return undefined;
  const days = range === '7d' ? 7 : range === '30d' ? 30 : 90;
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

/**
 * Shared by the Stats tab and the indexer sheet: range lives in the key, so
 * switching ranges refetches, and opening a sheet reuses what is cached.
 */
export function prowlarrStatsQuery(range: DateRange) {
  return {
    queryKey: ['prowlarr', 'stats', range],
    queryFn: ({ signal }: { signal?: AbortSignal }) => {
      const startDate = getStartDate(range);
      const url = startDate
        ? `/api/prowlarr/stats?startDate=${encodeURIComponent(startDate)}`
        : '/api/prowlarr/stats';
      return jsonFetcher<ProwlarrStats>(url)({ signal });
    },
    staleTime: 60_000,
  };
}
