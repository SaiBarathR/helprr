'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseWidgetDataOptions<T> {
  fetchFn: () => Promise<T>;
  refreshInterval: number;
  enabled?: boolean;
  /**
   * Stable key used to keep already-fetched data alive across re-mounts of the
   * same widget (e.g. the DragOverlay creates a fresh instance while the user
   * is dragging). If two callers share a key they share a cache slot AND
   * share a single in-flight fetch — duplicate widgets coalesce to one
   * network request.
   */
  cacheKey?: string;
}

interface UseWidgetDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

interface CacheEntry {
  data: unknown;
  time: number;
}

const CACHE_MAX_ENTRIES = 50;
const widgetDataCache = new Map<string, CacheEntry>();
const inflight = new Map<string, Promise<unknown>>();

function touchCache(key: string, entry: CacheEntry): void {
  widgetDataCache.delete(key);
  widgetDataCache.set(key, entry);
  while (widgetDataCache.size > CACHE_MAX_ENTRIES) {
    const oldest = widgetDataCache.keys().next().value;
    if (oldest === undefined) break;
    widgetDataCache.delete(oldest);
  }
}

export function useWidgetData<T>({
  fetchFn,
  refreshInterval,
  enabled = true,
  cacheKey,
}: UseWidgetDataOptions<T>): UseWidgetDataResult<T> {
  const [data, setData] = useState<T | null>(() => {
    if (cacheKey) {
      const cached = widgetDataCache.get(cacheKey);
      if (cached) return cached.data as T;
    }
    return null;
  });
  const [loading, setLoading] = useState(() => data === null);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;
  // Track the most recent cacheKey so an in-flight fetch from a previous key
  // can detect it's stale and skip writing back. Without this guard, when
  // cacheKey changes mid-flight (e.g. widget height crosses a bucket boundary
  // and limit grows from 20 → 40), the older request can resolve AFTER the
  // newer one and clobber the larger result with the smaller one.
  const activeKeyRef = useRef<string | undefined>(cacheKey);
  activeKeyRef.current = cacheKey;

  const doFetch = useCallback(async () => {
    const requestKey = cacheKey;
    try {
      let promise: Promise<T>;
      if (cacheKey) {
        const existing = inflight.get(cacheKey) as Promise<T> | undefined;
        if (existing) {
          promise = existing;
        } else {
          promise = fetchRef.current();
          inflight.set(cacheKey, promise);
          promise.finally(() => {
            // Only clear the slot if it still holds this exact promise; a
            // newer fetch may have already taken over.
            if (inflight.get(cacheKey) === promise) inflight.delete(cacheKey);
          });
        }
      } else {
        promise = fetchRef.current();
      }
      const result = await promise;
      if (activeKeyRef.current !== requestKey) {
        // cacheKey changed while we were fetching; result is stale.
        if (cacheKey) touchCache(cacheKey, { data: result, time: Date.now() });
        return;
      }
      setData(result);
      setError(null);
      if (cacheKey) touchCache(cacheKey, { data: result, time: Date.now() });
    } catch (e) {
      if (activeKeyRef.current !== requestKey) return;
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      if (activeKeyRef.current === requestKey) {
        setLoading(false);
      }
    }
  }, [cacheKey]);

  // When cacheKey changes we're effectively switching to a different query
  // (filter change, user switch, etc.). The old data is stale and showing it
  // mid-fetch is misleading — reset to loading state before the new fetch
  // lands. Skip the reset on the first render so a warm cache seeded via
  // useState survives mount (matters for DragOverlay remounts).
  const prevCacheKeyRef = useRef<string | undefined>(cacheKey);
  useEffect(() => {
    if (prevCacheKeyRef.current === cacheKey) return;
    prevCacheKeyRef.current = cacheKey;
    setData(null);
    setLoading(true);
    setError(null);
  }, [cacheKey]);

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return;
    }
    doFetch();
    const interval = setInterval(doFetch, refreshInterval);
    return () => clearInterval(interval);
  }, [doFetch, refreshInterval, enabled]);

  return { data, loading, error, refresh: doFetch };
}
