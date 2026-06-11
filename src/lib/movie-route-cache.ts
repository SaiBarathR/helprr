import type { DiscoverMovieFullDetail, QualityProfile, RadarrCredit, RadarrMovie, Tag } from '@/types';

export interface MovieDetailSnapshot {
  movie: RadarrMovie | null;
  qualityProfiles: QualityProfile[];
  tags: Tag[];
  tmdbData?: DiscoverMovieFullDetail | null;
  credits?: RadarrCredit[];
  fetchedAt: number;
}

interface SnapshotInput {
  fetchedAt?: number;
}

const MAX_ENTRIES = 100;
const DEFAULT_INSTANCE = 'default';
const movieDetailCache = new Map<string, MovieDetailSnapshot>();

function setWithLimit<K, V>(cache: Map<K, V>, key: K, value: V) {
  cache.set(key, value);
  if (cache.size <= MAX_ENTRIES) return;
  const oldestKey = cache.keys().next().value;
  if (oldestKey !== undefined) {
    cache.delete(oldestKey);
  }
}

// Keyed by instance so the same movie id in two Radarr instances never collides.
function cacheKey(instanceId: string, movieId: number) {
  return `${instanceId}:${movieId}`;
}

function withFetchedAt<T extends SnapshotInput>(snapshot: T): T & { fetchedAt: number } {
  return {
    ...snapshot,
    fetchedAt: snapshot.fetchedAt ?? Date.now(),
  };
}

export function getMovieDetailSnapshot(movieId: number, instanceId: string = DEFAULT_INSTANCE): MovieDetailSnapshot | null {
  return movieDetailCache.get(cacheKey(instanceId, movieId)) ?? null;
}

export function setMovieDetailSnapshot(
  movieId: number,
  snapshot: Omit<MovieDetailSnapshot, 'fetchedAt'> & SnapshotInput,
  instanceId: string = DEFAULT_INSTANCE
) {
  setWithLimit(movieDetailCache, cacheKey(instanceId, movieId), withFetchedAt(snapshot));
}

export function clearMovieDetailSnapshot(movieId: number, instanceId: string = DEFAULT_INSTANCE) {
  movieDetailCache.delete(cacheKey(instanceId, movieId));
}
