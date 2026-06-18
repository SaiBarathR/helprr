'use client';

import { useUIStore } from '@/lib/store';

const EMPTY: string[] = [];

// Recent-search history for a single search bar. `recent` is the 4 most recent
// terms (the only ones shown); removing a visible one auto-promotes the next of
// the up-to-20 stored terms, so the visible list stays full.
export function useSearchHistory(key: string) {
  const all = useUIStore((s) => s.searchHistory[key] ?? EMPTY);
  const addSearchTerm = useUIStore((s) => s.addSearchTerm);
  const removeSearchTerm = useUIStore((s) => s.removeSearchTerm);
  return {
    recent: all.slice(0, 4),
    add: (term: string) => addSearchTerm(key, term),
    remove: (term: string) => removeSearchTerm(key, term),
  };
}
