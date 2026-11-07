// Random's genre and length filters, shared by /api/random-watch, the
// household Tonight pick and the Random page. Safe to import on the client.

import type { RandomWatchFilterType } from '@/types';

/**
 * Length presets, for movies only: a movie is matched by its runtime, and an
 * unknown runtime matches only "any". Series ignore the length (an episode's
 * length says little about a show).
 */
export type RandomRuntime = 'any' | 'under90' | '90to120' | 'over120';

export const RANDOM_RUNTIMES: readonly RandomRuntime[] = ['any', 'under90', '90to120', 'over120'];

export const RANDOM_RUNTIME_LABELS: Record<RandomRuntime, string> = {
  any: 'Any length',
  under90: 'Under 90 min',
  '90to120': '90–120 min',
  over120: 'Over 2 hours',
};

export interface RandomPoolFilters {
  /** Matches a title with any of these genres; empty matches every title. */
  genres: string[];
  runtime: RandomRuntime;
}

// Movie and TV genres together run to about 40.
export const MAX_RANDOM_GENRES = 50;
const MAX_GENRE_LENGTH = 60;

export function isRandomRuntime(value: unknown): value is RandomRuntime {
  return typeof value === 'string' && (RANDOM_RUNTIMES as readonly string[]).includes(value);
}

/** Trimmed, distinct genre names; null when the value is not a list of short strings. */
export function parseRandomGenres(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > MAX_RANDOM_GENRES) return null;
  const genres: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string') return null;
    const genre = item.trim();
    if (!genre || genre.length > MAX_GENRE_LENGTH) return null;
    if (!genres.includes(genre)) genres.push(genre);
  }
  return genres;
}

function runtimeMatches(runtime: number | null | undefined, preset: RandomRuntime): boolean {
  if (preset === 'any') return true;
  if (!runtime || runtime <= 0) return false;
  if (preset === 'under90') return runtime < 90;
  if (preset === '90to120') return runtime <= 120 && runtime >= 90;
  return runtime > 120;
}

export function matchesRandomFilters(
  item: { genres?: string[] | null; runtime?: number | null },
  filters: Partial<RandomPoolFilters>,
  mediaType: 'movie' | 'series',
): boolean {
  const wanted = filters.genres ?? [];
  if (wanted.length > 0 && !(item.genres ?? []).some((genre) => wanted.includes(genre))) return false;
  return mediaType === 'series' || runtimeMatches(item.runtime, filters.runtime ?? 'any');
}

/** Every genre in the pool, sorted, for the genre picker. */
export function poolGenres(items: { genres?: string[] | null }[]): string[] {
  const all = new Set<string>();
  for (const item of items) for (const genre of item.genres ?? []) if (genre) all.add(genre);
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** Random's filters as this device remembers them. */
export interface RandomWatchPrefs extends RandomPoolFilters {
  type: RandomWatchFilterType;
  unwatched: boolean;
}

export const DEFAULT_RANDOM_WATCH_PREFS: RandomWatchPrefs = { type: 'any', unwatched: false, genres: [], runtime: 'any' };

/** A saved or imported value made usable; anything unreadable takes the default. */
export function normalizeRandomWatchPrefs(value: unknown): RandomWatchPrefs {
  const v = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  return {
    type: v.type === 'movie' || v.type === 'series' ? v.type : 'any',
    unwatched: v.unwatched === true,
    genres: parseRandomGenres(v.genres) ?? [],
    runtime: isRandomRuntime(v.runtime) ? v.runtime : 'any',
  };
}
