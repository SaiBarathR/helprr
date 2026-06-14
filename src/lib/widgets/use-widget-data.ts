'use client';

import { useId } from 'react';
import { useQuery } from '@tanstack/react-query';

interface UseWidgetDataOptions<T> {
  fetchFn: () => Promise<T>;
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
}

interface UseWidgetDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

/**
 * Widget data hook, backed by TanStack Query. Public API is unchanged so every
 * widget keeps working as-is. Behavior parity with the previous hand-rolled
 * implementation:
 *   - constant-cadence polling at `refreshInterval` (keeps polling while the tab
 *     is backgrounded, like the old setInterval),
 *   - cross-instance cache + in-flight coalescing when `cacheKey` is shared,
 *   - resets to a loading state when `cacheKey` changes (different query),
 *   - warm cache survives a remount within one interval.
 */
export function useWidgetData<T>({
  fetchFn,
  refreshInterval,
  enabled = true,
  cacheKey,
}: UseWidgetDataOptions<T>): UseWidgetDataResult<T> {
  // No cacheKey → a stable per-instance key so instances don't share (matches the
  // old behavior where keyless callers each fetched independently).
  const fallbackKey = useId();

  const query = useQuery<T>({
    queryKey: ['widget-data', cacheKey ?? fallbackKey],
    // useQuery always invokes the latest queryFn from the most recent render,
    // so this picks up an updated fetchFn without a ref.
    queryFn: () => fetchFn(),
    enabled,
    refetchInterval: refreshInterval,
    refetchIntervalInBackground: true,
    refetchOnWindowFocus: false,
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
