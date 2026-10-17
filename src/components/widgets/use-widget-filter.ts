'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

const STORAGE_PREFIX = 'helprr-widget-filters:';

function storageKey(widgetId: string): string {
  return `${STORAGE_PREFIX}${widgetId}`;
}

function readStored<T>(widgetId: string, defaults: T): T {
  if (typeof window === 'undefined') return defaults;
  try {
    const raw = window.localStorage.getItem(storageKey(widgetId));
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Partial<T>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

export function useWidgetFilter<T extends object>(
  widgetId: string,
  defaults: T,
): [T, (next: T | ((prev: T) => T)) => void, () => void] {
  // Start from `defaults` so the server-rendered HTML and the first client
  // render match; sync to localStorage in an effect after hydration. Reading
  // localStorage in useState's initializer caused FilterIconButton's `active`
  // state (and its inline styles) to diverge between server and client.
  const [filters, setFilters] = useState<T>(defaults);

  // Callers may pass a new defaults object on every render. Keep the latest in
  // a ref: stored filters are read again when the widget id changes, not when
  // the defaults' identity (or value) does.
  const defaultsRef = useRef(defaults);
  useEffect(() => {
    defaultsRef.current = defaults;
  });

  useEffect(() => {
    setFilters(readStored(widgetId, defaultsRef.current));
  }, [widgetId]);

  const update = useCallback(
    (next: T | ((prev: T) => T)) => {
      setFilters((prev) => {
        const resolved = typeof next === 'function' ? (next as (p: T) => T)(prev) : next;
        if (typeof window !== 'undefined') {
          try {
            window.localStorage.setItem(storageKey(widgetId), JSON.stringify(resolved));
          } catch {
            // ignore quota errors — filter values are non-critical
          }
        }
        return resolved;
      });
    },
    [widgetId],
  );

  const reset = useCallback(() => {
    if (typeof window !== 'undefined') {
      try {
        window.localStorage.removeItem(storageKey(widgetId));
      } catch {
        // ignore
      }
    }
    setFilters(defaultsRef.current);
  }, [widgetId]);

  // Re-sync if another tab updates this widget's filters
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = storageKey(widgetId);
    function onStorage(e: StorageEvent) {
      if (e.key !== key) return;
      setFilters(readStored(widgetId, defaultsRef.current));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [widgetId]);

  return [filters, update, reset];
}
