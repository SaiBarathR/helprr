import type { QualityProfile, RadarrMovie, Tag } from '@/types';

export interface MovieDetailSnapshot {
  movie: RadarrMovie | null;
  qualityProfiles: QualityProfile[];
  tags: Tag[];
  fetchedAt: number;
}

interface SnapshotInput {
  fetchedAt?: number;
}

const MAX_ENTRIES = 100;
const movieDetailCache = new Map<number, MovieDetailSnapshot>();

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

export function getMovieDetailSnapshot(movieId: number): MovieDetailSnapshot | null {
  return movieDetailCache.get(movieId) ?? null;
}

export function setMovieDetailSnapshot(
  movieId: number,
  snapshot: Omit<MovieDetailSnapshot, 'fetchedAt'> & SnapshotInput
) {
  setWithLimit(movieDetailCache, movieId, withFetchedAt(snapshot));
}
