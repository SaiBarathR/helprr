import type { DiscoverLibraryStatus } from '@/types';
import type { AniListDetailResponse, AniListMangaDetailResponse } from '@/types/anilist';

export type AnimeDetailSnapshotData = AniListDetailResponse & {
  library?: DiscoverLibraryStatus | null;
  libraryAvailability?: {
    radarr: 'ok' | 'unavailable';
    sonarr: 'ok' | 'unavailable';
  };
};

export interface AnimeDetailSnapshot {
  detail: AnimeDetailSnapshotData | null;
  fetchedAt: number;
}

export interface MangaDetailSnapshot {
  detail: AniListMangaDetailResponse | null;
  fetchedAt: number;
}

interface SnapshotInput {
  fetchedAt?: number;
}

const MAX_ENTRIES = 100;
const animeDetailCache = new Map<string, AnimeDetailSnapshot>();
const mangaDetailCache = new Map<string, MangaDetailSnapshot>();

function setWithLimit<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.set(key, value);
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

function withFetchedAt<T extends SnapshotInput>(snapshot: T): T & { fetchedAt: number } {
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt ?? Date.now(),
  };
}

export function getAnimeDetailSnapshot(id: string | number): AnimeDetailSnapshot | null {
  return animeDetailCache.get(String(id)) ?? null;
}

export function setAnimeDetailSnapshot(
  id: string | number,
  snapshot: Omit<AnimeDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(animeDetailCache, String(id), withFetchedAt(snapshot));
}

export function getMangaDetailSnapshot(id: string | number): MangaDetailSnapshot | null {
  return mangaDetailCache.get(String(id)) ?? null;
}

export function setMangaDetailSnapshot(
  id: string | number,
  snapshot: Omit<MangaDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(mangaDetailCache, String(id), withFetchedAt(snapshot));
}
