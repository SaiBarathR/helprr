// View-state only (scroll position + search + per-list extras). The data-caching
// half was removed once all list pages moved to TanStack Query — the query cache
// now provides dedup/staleness/back-nav, so this module just persists scroll/UI.

export type MediaListKey =
  | 'movies'
  | 'series'
  | 'music'
  | `anime-library:${string}`
  | `anime-explore:${string}`;

export interface MediaListViewState {
  scrollY: number;
  search: string;
  updatedAt: number;
  extras?: Record<string, unknown>;
}

const viewCache: Partial<Record<MediaListKey, MediaListViewState>> = {};

function viewStorageKey(key: MediaListKey) {
  return `helprr:list-view:${key}`;
}

function isBrowser() {
  return typeof window !== 'undefined';
}

export function getListViewState(key: MediaListKey): MediaListViewState | null {
  const inMemory = viewCache[key];
  if (inMemory) return inMemory;
  if (!isBrowser()) return null;

  try {
    const raw = sessionStorage.getItem(viewStorageKey(key));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<MediaListViewState>;
    if (typeof parsed.scrollY !== 'number' || typeof parsed.search !== 'string') return null;

    const restored: MediaListViewState = {
      scrollY: parsed.scrollY,
      search: parsed.search,
      updatedAt: typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Date.now(),
      extras: parsed.extras && typeof parsed.extras === 'object' ? parsed.extras as Record<string, unknown> : undefined,
    };

    viewCache[key] = restored;
    return restored;
  } catch {
    return null;
  }
}

export function setListViewState(key: MediaListKey, next: Omit<MediaListViewState, 'updatedAt'>) {
  const value: MediaListViewState = {
    ...next,
    updatedAt: Date.now(),
  };

  viewCache[key] = value;

  if (!isBrowser()) return;

  try {
    sessionStorage.setItem(viewStorageKey(key), JSON.stringify(value));
  } catch {
    // Ignore quota/security errors.
  }
}
