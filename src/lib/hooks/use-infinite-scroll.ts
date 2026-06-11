'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

export interface InfinitePage<T> {
  results: T[];
  /** Total rows matching the query (from pageInfo.results), so we know when to stop. */
  total: number;
}

export interface UseInfiniteScrollOptions<T> {
  /** Fetch one page. `skip` is the cursor offset, `take` the page size. */
  fetchPage: (skip: number, take: number) => Promise<InfinitePage<T>>;
  /** Stable id per row — used to dedupe across pages when the upstream window shifts. */
  getId: (item: T) => string | number;
  take?: number;
  /** When this string changes (filter/sort signature) the list resets to page 0. */
  resetKey?: string;
  rootMargin?: string;
  enabled?: boolean;
}

export interface UseInfiniteScrollResult<T> {
  items: T[];
  total: number;
  loading: boolean;
  loadingMore: boolean;
  error: string | null;
  hasMore: boolean;
  /** Attach to a bottom sentinel for auto-load on scroll (optional). */
  sentinelRef: React.RefObject<HTMLDivElement | null>;
  /** Manually fetch the next page — for a "Load more" button instead of a sentinel. */
  loadMore: () => void;
  /** Reload from scratch (page 0), e.g. after a mutation. */
  reload: () => void;
  /** Optimistically drop a row so it doesn't pop back until the next reload. */
  removeItem: (id: string | number) => void;
}

/**
 * Generic IntersectionObserver-driven infinite scroll. Lifted from the proven
 * cursor/dedupe logic in requests-list-widget so every consumer behaves the
 * same under concurrent inserts: the cursor advances by the size of each
 * fetched page (max'd against rendered count), and rows are deduped by id.
 */
export function useInfiniteScroll<T>({
  fetchPage,
  getId,
  take = 50,
  resetKey = '',
  rootMargin = '400px',
  enabled = true,
}: UseInfiniteScrollOptions<T>): UseInfiniteScrollResult<T> {
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exhausted, setExhausted] = useState(false);

  // Cursor advances by fetched-page size, not rendered count — so a row sliding
  // into our skip range can't trap us refetching the same offset forever.
  const skipRef = useRef(0);
  const inFlightRef = useRef(false);
  const itemsLengthRef = useRef(0);
  itemsLengthRef.current = items.length;

  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const loadPage = useCallback(
    async (skip: number, replace: boolean) => {
      if (inFlightRef.current) return;
      inFlightRef.current = true;
      if (replace) setLoading(true);
      else setLoadingMore(true);
      try {
        const page = await fetchPage(skip, take);
        setError(null);
        setTotal(page.total);
        setItems((prev) => {
          const base = replace ? [] : prev;
          const seen = new Set(base.map((r) => getId(r)));
          const merged = [...base];
          for (const r of page.results) {
            const id = getId(r);
            if (seen.has(id)) continue;
            seen.add(id);
            merged.push(r);
          }
          return merged;
        });
        skipRef.current = skip + page.results.length;
        if (page.results.length === 0 || skipRef.current >= page.total) {
          setExhausted(true);
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load');
      } finally {
        inFlightRef.current = false;
        if (replace) setLoading(false);
        else setLoadingMore(false);
      }
    },
    [fetchPage, take, getId]
  );

  // Reset + load page 0 whenever the query identity changes.
  useEffect(() => {
    if (!enabled) return;
    skipRef.current = 0;
    setExhausted(false);
    void loadPage(0, true);
  }, [resetKey, enabled, loadPage]);

  const hasMore = enabled && !exhausted && items.length < total;

  const loadMore = useCallback(() => {
    if (!hasMore || inFlightRef.current) return;
    const skip = Math.max(skipRef.current, itemsLengthRef.current);
    if (skip >= total) {
      setExhausted(true);
      return;
    }
    void loadPage(skip, false);
  }, [hasMore, total, loadPage]);

  useEffect(() => {
    if (!hasMore) return;
    const sentinel = sentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) loadMore();
      },
      { root: null, rootMargin }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadMore, rootMargin]);

  const reload = useCallback(() => {
    skipRef.current = 0;
    setExhausted(false);
    void loadPage(0, true);
  }, [loadPage]);

  const removeItem = useCallback(
    (id: string | number) => {
      setItems((prev) => prev.filter((r) => getId(r) !== id));
      setTotal((t) => Math.max(0, t - 1));
    },
    [getId]
  );

  return useMemo(
    () => ({
      items,
      total,
      loading,
      loadingMore,
      error,
      hasMore,
      sentinelRef,
      loadMore,
      reload,
      removeItem,
    }),
    [items, total, loading, loadingMore, error, hasMore, loadMore, reload, removeItem]
  );
}
