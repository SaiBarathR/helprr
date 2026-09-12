'use client';

import { useCallback, useState, useSyncExternalStore, type Dispatch, type SetStateAction } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';

// Only small presentation state belongs here. API payloads remain in QueryClient.
// A single tab-scoped, bounded record also survives reload without growing a
// sessionStorage key for every media item a user has ever opened.
const STORAGE_KEY = 'helprr:route-views:v1';
const MAX_ROUTES = 100;
const routes = new Map<string, Record<string, unknown>>();
const listeners = new Set<() => void>();
let loaded = false;
let writeTimer: ReturnType<typeof setTimeout> | undefined;

function load() {
  if (loaded || typeof window === 'undefined') return;
  loaded = true;
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    const entries: unknown = raw ? JSON.parse(raw, (_key, value) => {
      if (value && typeof value === 'object' && typeof value.__helprrDate === 'string') {
        return new Date(value.__helprrDate);
      }
      if (value && typeof value === 'object' && value.__helprrSet === true && Array.isArray(value.values)) {
        return new Set(value.values);
      }
      return value;
    }) : [];
    if (!Array.isArray(entries)) return;
    for (const entry of entries.slice(-MAX_ROUTES)) {
      if (Array.isArray(entry) && typeof entry[0] === 'string' && entry[1] && typeof entry[1] === 'object') {
        routes.set(entry[0], entry[1]);
      }
    }
  } catch { /* Storage policies must not prevent navigation. */ }
}

function persist() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = undefined;
  while (routes.size > MAX_ROUTES) routes.delete(routes.keys().next().value!);
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify([...routes], function (this: Record<string, unknown>, key, value) {
      const original = this[key];
      if (original instanceof Date) return { __helprrDate: original.toISOString() };
      return value instanceof Set ? { __helprrSet: true, values: [...value] } : value;
    }));
  } catch { /* Keep the in-memory state when storage is unavailable. */ }
}

const subscribe = (listener: () => void) => {
  if (listeners.size === 0) window.addEventListener('pagehide', persist);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      window.removeEventListener('pagehide', persist);
      if (writeTimer) persist();
    }
  };
};

/** Preserve the view that gives a route its scroll geometry, without retaining
 * mounted pages, background effects, action dialogs, or fetched media payloads.
 * The server snapshot is the initial value, avoiding hydration mismatches. */
export function useRouteViewState<T>(name: string, initial: T | (() => T)): [T, Dispatch<SetStateAction<T>>] {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const params = new URLSearchParams(searchParams?.toString());
  params.sort();
  const route = `${pathname}?${params}`;
  const [fallback] = useState(initial);
  const getSnapshot = useCallback(() => {
    load();
    const values = routes.get(route);
    return values && Object.hasOwn(values, name) ? values[name] as T : fallback;
  }, [route, name, fallback]);
  const getServerSnapshot = useCallback(() => fallback, [fallback]);
  const value = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const setValue = useCallback<Dispatch<SetStateAction<T>>>((next) => {
    const previous = getSnapshot();
    const updated = typeof next === 'function' ? (next as (previous: T) => T)(previous) : next;
    if (Object.is(previous, updated)) return;
    const values = { ...routes.get(route), [name]: updated };
    const keys = Object.keys(values);
    for (const key of keys.slice(0, Math.max(0, keys.length - 100))) delete values[key];
    routes.delete(route);
    routes.set(route, values);
    // In-memory snapshots update immediately; typing and translated rail wheel
    // gestures share one storage write instead of serializing on every frame.
    if (!writeTimer) writeTimer = setTimeout(persist, 250);
    listeners.forEach((listener) => listener());
  }, [getSnapshot, route, name]);
  return [value, setValue];
}

export function resetRouteViewStateForTests() {
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = undefined;
  loaded = false;
  routes.clear();
}
