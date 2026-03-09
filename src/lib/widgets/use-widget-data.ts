'use client';

import { useState, useEffect, useCallback, useRef } from 'react';

interface UseWidgetDataOptions<T> {
  fetchFn: () => Promise<T>;
  refreshInterval: number;
  enabled?: boolean;
}

interface UseWidgetDataResult<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

export function useWidgetData<T>({
  fetchFn,
  refreshInterval,
  enabled = true,
}: UseWidgetDataOptions<T>): UseWidgetDataResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchRef = useRef(fetchFn);
  fetchRef.current = fetchFn;

  const doFetch = useCallback(async () => {
    try {
      const result = await fetchRef.current();
      setData(result);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch');
    } finally {
      setLoading(false);
    }
  }, []);

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
