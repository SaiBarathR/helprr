import { describe, expect, it } from 'vitest';
import {
  DEFAULT_RANDOM_WATCH_PREFS,
  matchesRandomFilters,
  normalizeRandomWatchPrefs,
  parseRandomGenres,
  poolGenres,
} from '@/lib/random-watch-filters';

describe('matchesRandomFilters', () => {
  it('matches any of the chosen genres, and everything with none chosen', () => {
    const comedy = { genres: ['Comedy', 'Romance'], runtime: 100 };
    expect(matchesRandomFilters(comedy, { genres: [] })).toBe(true);
    expect(matchesRandomFilters(comedy, { genres: ['Drama', 'Romance'] })).toBe(true);
    expect(matchesRandomFilters(comedy, { genres: ['Drama'] })).toBe(false);
    expect(matchesRandomFilters({ genres: undefined }, { genres: ['Drama'] })).toBe(false);
  });

  it.each([
    [89, 'under90', true], [90, 'under90', false],
    [90, '90to120', true], [120, '90to120', true], [121, '90to120', false],
    [120, 'over120', false], [121, 'over120', true],
  ] as const)('a %i-minute title is %s: %s', (runtime, preset, expected) => {
    expect(matchesRandomFilters({ runtime }, { runtime: preset })).toBe(expected);
  });

  it('matches an unknown length only with any length', () => {
    for (const runtime of [0, null, undefined]) {
      expect(matchesRandomFilters({ runtime }, { runtime: 'any' })).toBe(true);
      expect(matchesRandomFilters({ runtime }, { runtime: 'under90' })).toBe(false);
    }
  });
});

describe('parsing', () => {
  it('trims and dedupes genres, and refuses anything that is not a short list of names', () => {
    expect(parseRandomGenres([' Comedy ', 'Comedy', 'Drama'])).toEqual(['Comedy', 'Drama']);
    expect(parseRandomGenres('Comedy')).toBeNull();
    expect(parseRandomGenres([''])).toBeNull();
    expect(parseRandomGenres(['x'.repeat(61)])).toBeNull();
    expect(parseRandomGenres(Array.from({ length: 51 }, (_, i) => `G${i}`))).toBeNull();
  });

  it('lists the pool genres once each, sorted', () => {
    expect(poolGenres([{ genres: ['Drama', 'Action'] }, { genres: ['Action'] }, {}])).toEqual(['Action', 'Drama']);
  });

  it('makes a saved or imported value usable', () => {
    expect(normalizeRandomWatchPrefs(undefined)).toEqual(DEFAULT_RANDOM_WATCH_PREFS);
    expect(normalizeRandomWatchPrefs({ type: 'music', unwatched: 'yes', genres: [1], runtime: 'long' })).toEqual(DEFAULT_RANDOM_WATCH_PREFS);
    expect(normalizeRandomWatchPrefs({ type: 'movie', unwatched: true, genres: ['Comedy'], runtime: 'over120' }))
      .toEqual({ type: 'movie', unwatched: true, genres: ['Comedy'], runtime: 'over120' });
  });
});
