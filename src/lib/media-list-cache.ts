export const MEDIA_LIST_CACHE_TTL_MS = 60_000;

export type MediaListKey = 'movies' | 'series';

export interface MediaListDataCache<T> {
  data: T;
  fetchedAt: number;
}

export interface MediaListViewState {
  scrollY: number;
  search: string;
  updatedAt: number;
}

const dataCache: Partial<Record<MediaListKey, MediaListDataCache<unknown>>> = {};
const viewCache: Partial<Record<MediaListKey, MediaListViewState>> = {};

function viewStorageKey(key: MediaListKey) {
  return `helprr:list-view:${key}`;
}

function isBrowser() {
  return typeof window !== 'undefined';
}

export function getCachedListData<T>(key: MediaListKey): MediaListDataCache<T> | null {
  const entry = dataCache[key];
  if (!entry) return null;
  return entry as MediaListDataCache<T>;
}

export function setCachedListData<T>(
  key: MediaListKey,
  data: T,
  fetchedAt: number = Date.now()
) {
  dataCache[key] = { data, fetchedAt };
}

export function isListDataFresh<T>(entry: MediaListDataCache<T>, ttlMs = MEDIA_LIST_CACHE_TTL_MS) {
  return Date.now() - entry.fetchedAt <= ttlMs;
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
