'use client';

import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react';

// State that belongs to one browser history entry, kept in history.state: it
// comes back with Back and Forward (and a reload), while a new visit to the
// same URL is a new entry and starts from the initial value. Route view state
// (use-route-view-state) is per URL instead, shared by every visit to it.
//
// Next writes the entry itself after each of its navigations, once the page
// has rendered, and a navigation that stays on the entry (tapping the page's
// own nav link, a refresh) drops every other key. So the hook holds the value
// for the entry's address and checks the entry again after each commit.

function readEntry(key: string): boolean | undefined {
  const value = (window.history.state as Record<string, unknown> | null)?.[key];
  return typeof value === 'boolean' ? value : undefined;
}

function writeEntry(key: string, value: boolean) {
  window.history.replaceState({ ...(window.history.state ?? {}), [key]: value }, '');
}

export function useHistoryEntryState(key: string, initial: boolean): [boolean, (value: boolean) => void] {
  const held = useRef<{ href: string; value: boolean } | null>(null);
  const changed = useRef<(() => void) | null>(null);

  const subscribe = useCallback((onChange: () => void) => {
    changed.current = onChange;
    // Back and Forward land on an entry that keeps its own value.
    const onPopState = () => {
      held.current = { href: window.location.href, value: readEntry(key) ?? initial };
      onChange();
    };
    window.addEventListener('popstate', onPopState);
    return () => {
      changed.current = null;
      window.removeEventListener('popstate', onPopState);
    };
  }, [key, initial]);

  const getSnapshot = useCallback(() => {
    const stored = readEntry(key);
    if (stored !== undefined) return stored;
    return held.current?.href === window.location.href ? held.current.value : initial;
  }, [key, initial]);

  const value = useSyncExternalStore(subscribe, getSnapshot, () => initial);

  // After every commit, so after Next has written the entry for it. The same
  // address without the value is Next rewriting this entry: put the value
  // back. A new address is a new entry (or one replaced for a new address)
  // and starts from what it holds.
  useEffect(() => {
    const href = window.location.href;
    const stored = readEntry(key);
    if (stored === undefined && held.current?.href === href && held.current.value !== initial) {
      writeEntry(key, held.current.value);
    } else {
      held.current = { href, value: stored ?? initial };
    }
    changed.current?.();
  });

  const setValue = useCallback((next: boolean) => {
    writeEntry(key, next);
    held.current = { href: window.location.href, value: next };
    changed.current?.();
  }, [key]);

  return [value, setValue];
}
