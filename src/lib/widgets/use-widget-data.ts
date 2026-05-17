'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseWidgetDataOptions<T> {
  fetchFn: () => Promise<T>;
  refreshInterval: number;
  enabled?: boolean;
  /**
   * Stable key used to keep already-fetched data alive across re-mounts of the
   * same widget (e.g. the DragOverlay creates a fresh instance while the user
   * is dragging). If two callers share a key they share a cache slot.
   */
  cacheKey?: string;
}

interface UseWidgetDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

interface CacheEntry {
  data: unknown;
  time: number;
}

// Module-level cache shared by every useWidgetData instance.
const widgetDataCache = new Map<string, CacheEntry>();

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

  const doFetch = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      setData(result);
      setError(null);
      if (cacheKey) widgetDataCache.set(cacheKey, { data: result, time: Date.now() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
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

  return { data, loading, error };
}
