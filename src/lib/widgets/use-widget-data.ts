'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';

interface UseWidgetDataOptions<T> {
  /** Receives TanStack Query's AbortSignal so fetchers that forward it to
   *  fetch() are cancelled when the query key changes or the widget unmounts. */
  fetchFn: (signal?: AbortSignal) => Promise<T>;
  refreshInterval: number;
  enabled?: boolean;
  /**
   * Stable key used to keep already-fetched data alive across re-mounts of the
   * same widget (e.g. the DragOverlay creates a fresh instance while dragging).
   * Callers sharing a key share a cache slot AND a single in-flight fetch —
   * duplicate widgets coalesce to one request. (Now backed by TanStack Query's
   * keyed cache + request dedup; previously a hand-rolled Map.)
   */
  cacheKey?: string;
  /**
   * Refetch immediately when the tab/window regains focus. Default `false`.
   * Opt-in for live widgets (queue, Jellyfin activity, continue-watching, service
   * health) so they refresh the instant the user returns; static widgets
   * (calendar, upcoming, stats, …) leave it off and wait for the next interval.
   */
  refetchOnFocus?: boolean;
}

interface UseWidgetDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Widget data hook, backed by TanStack Query. Behavior:
 *   - polls at a FIXED `refreshInterval` (no backoff) so a widget pointed at a
 *     briefly-down service recovers within one interval once it returns,
 *   - PAUSES polling while the tab is hidden (`refetchIntervalInBackground:false`):
 *     a dashboard mounts ~10-15 widgets; polling them all in a backgrounded iOS
 *     PWA is exactly the focus/background churn the app avoids. (The old
 *     hand-rolled hook never paused — this is a deliberate change.)
 *   - optionally refetches on focus (`refetchOnFocus`, default off) so live
 *     widgets refresh the instant the user returns; static ones wait for the tick,
 *   - cross-instance cache + in-flight coalescing when `cacheKey` is shared,
 *   - resets to a loading state when `cacheKey` changes (different query),
 *   - warm cache survives a remount within one interval.
 */
export function useWidgetData<T>({
  fetchFn,
  refreshInterval,
  enabled = true,
  cacheKey,
  refetchOnFocus = false,
}: UseWidgetDataOptions<T>): UseWidgetDataResult<T> {
  // No cacheKey → a stable per-instance key so instances don't share (matches the
  // old behavior where keyless callers each fetched independently).
  const fallbackKey = useId();

  const query = useQuery<T>({
    queryKey: ['widget-data', cacheKey ?? fallbackKey],
    // useQuery always invokes the latest queryFn from the most recent render,
    // so this picks up an updated fetchFn without a ref.
    queryFn: ({ signal }) => fetchFn(signal),
    enabled,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: refetchOnFocus,
    // Refetch on every mount (matching the old doFetch-on-mount), but the keyed
    // cache still shows the previous value immediately during that refetch — so
    // a remount (DragOverlay, a key-change refresh) gets fresh data with no
    // loading flash.
    staleTime: 0,
    gcTime: 5 * 60_000,
  });

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.isError
      ? query.error instanceof Error
        ? query.error.message
        : 'Failed to fetch'
      : null,
    refresh: async () => {
      await query.refetch();
    },
  };
}
