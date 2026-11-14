'use client';

import { useEffect, useId, useState } from 'react';
import { useQuery, type FetchStatus } from '@tanstack/react-query';
import { useWidgetVisibility } from './widget-visibility-context';
import { useReportWidgetUnavailable, type WidgetUnavailable } from './widget-unavailable-context';
import { watchSavedCopy, type SavedCopy } from './widget-fetch';
import { forgetBrowseFreshness } from '@/lib/browse-freshness';
import { isOfflineError, isQueryOffline, OfflineError } from '@/lib/network-error';
import { SNAPSHOT_MAX_AGE_MS } from '@/lib/offline-snapshot';

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
  /** Keep a shared resource fresh across closely spaced consumer mounts. */
  staleTime?: number;
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
  /** Nothing loaded because the device is offline (a paused or offline-failed fetch). */
  offline: boolean;
  refresh: () => Promise<void>;
}

// The saved copy each widget query last loaded, by query key: kept beside the
// TanStack cache rather than in it, so cached data keeps the fetcher's shape.
const savedCopies = new Map<string, SavedCopy>();

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
  staleTime,
  refetchOnFocus = false,
}: UseWidgetDataOptions<T>): UseWidgetDataResult<T> {
  // No cacheKey → a stable per-instance key so instances don't share (matches the
  // old behavior where keyless callers each fetched independently).
  const fallbackKey = useId();
  const widgetVisible = useWidgetVisibility();
  const queryEnabled = enabled && widgetVisible;
  const key = cacheKey ?? fallbackKey;

  const query = useQuery<T>({
    queryKey: ['widget-data', key],
    // useQuery always invokes the latest queryFn from the most recent render,
    // so this picks up an updated fetchFn without a ref.
    queryFn: async ({ signal }) => {
      const copy = watchSavedCopy(signal);
      const data = await fetchFn(signal);
      if (copy.at) savedCopies.set(key, copy);
      else savedCopies.delete(key);
      return data;
    },
    enabled: queryEnabled,
    refetchInterval: queryEnabled ? refreshInterval : false,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: refetchOnFocus,
    // Returning to the dashboard shouldn't re-download every widget at once.
    // Live widgets retain immediate focus refresh; explicit freshness wins.
    staleTime: staleTime ?? (refetchOnFocus ? 0 : Math.min(refreshInterval, 30_000)),
    gcTime: 5 * 60_000,
    // Offline, still ask once: the service worker answers a saved-copy route
    // with its labelled copy, and fails any other at once. Its retry then
    // waits for the device to be back online, so polling sends no more.
    networkMode: 'offlineFirst',
  });

  // A saved copy shows for five minutes after it was saved, then "You're offline"
  // (the owner's rule, and the worker's own limit), even between two polls.
  const copy = query.data !== undefined ? savedCopies.get(key) : undefined;
  const savedAt = copy?.at ?? 0;
  const [expiredAt, setExpiredAt] = useState(0);
  useEffect(() => {
    if (!savedAt || !copy) return;
    const timer = setTimeout(() => {
      copy.paths.forEach(forgetBrowseFreshness);
      setExpiredAt(savedAt);
    }, Math.max(0, savedAt + SNAPSHOT_MAX_AGE_MS - Date.now()));
    return () => clearTimeout(timer);
  }, [savedAt, copy]);
  const unavailable = widgetUnavailable(query)
    ?? (savedAt && expiredAt === savedAt ? (navigator.onLine ? 'unreachable' : 'offline') : null);
  useReportWidgetUnavailable(unavailable);

  return {
    data: query.data ?? null,
    loading: query.isLoading,
    error: query.isError ? widgetErrorText(query.error) : null,
    offline: isQueryOffline(query),
    refresh: async () => {
      await query.refetch();
    },
  };
}

/**
 * Whether a widget query has nothing it can truthfully show because Helprr
 * could not be reached: data from before the failure would look live, and no
 * data would show as zeros or "Queue is empty". A server's error answer is not
 * this; the widget keeps its own message for that.
 */
export function widgetUnavailable(query: {
  isError: boolean;
  error: unknown;
  fetchStatus: FetchStatus;
  data: unknown;
}): WidgetUnavailable | null {
  // Waiting to retry until the device is back online.
  if (query.fetchStatus === 'paused') return 'offline';
  if (!query.isError) return null;
  if (isOfflineError(query.error)) return 'offline';
  // fetch() rejects with a TypeError when no answer came (see widgetErrorText).
  return query.error instanceof TypeError || query.error instanceof OfflineError ? 'unreachable' : null;
}

/**
 * What a widget says when its fetch fails. A network failure (fetch throws a
 * TypeError) carries the browser's own words, on iOS offline the service
 * worker's "FetchEvent.respondWith received an error: no-response …" with the
 * request URL, shown in red on the Dashboard. A server's answer keeps its message.
 */
export function widgetErrorText(error: unknown): string {
  if (error instanceof TypeError) return 'Can’t reach Helprr right now.';
  return error instanceof Error ? error.message : 'Failed to fetch';
}
