'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';

// State that belongs to one browser history entry, kept in history.state: it
// comes back with Back and Forward (and a reload), while a new visit to the
// same URL is a new entry and starts from the initial value. Route view state
// (use-route-view-state) is per URL instead, shared by every visit to it.

const listeners = new Set<() => void>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener('popstate', listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener('popstate', listener);
  };
}

export function useHistoryEntryState(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const getSnapshot = useCallback(() => {
    const state = window.history.state as Record<string, unknown> | null;
    return state && typeof state[key] === 'boolean' ? state[key] as boolean : initial;
  }, [key, initial]);
  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial);

  // A page reached by a forward navigation renders before the router writes
  // its new history entry, so read the entry again once that has happened.
  useEffect(notify, []);

  const setValue = useCallback((next: boolean) => {
    window.history.replaceState({ ...(window.history.state ?? {}), [key]: next }, '');
    notify();
  }, [key]);
  return [value, setValue];
}
