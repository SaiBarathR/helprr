'use client';

import { useCallback, useEffect, useState } from 'react';

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

  useEffect(() => {
    setFilters(readStored(widgetId, defaults));
    // Re-read only on widgetId change; `defaults` is expected to be referentially
    // stable per call site (it always is in current usages).
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setFilters(defaults);
  }, [widgetId, defaults]);

  // Re-sync if another tab updates this widget's filters
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const key = storageKey(widgetId);
    function onStorage(e: StorageEvent) {
      if (e.key !== key) return;
      setFilters(readStored(widgetId, defaults));
    }
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [widgetId, defaults]);

  return [filters, update, reset];
}
