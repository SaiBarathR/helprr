import { describe, expect, it } from 'vitest';
import { emptyTasteProfile, type TasteProfile } from '@/lib/recommendations/profile-types';
import {
  franchiseKey,
  hashSeed,
  scoreCandidates,
  seededRng,
  selectRailItems,
} from '@/lib/recommendations/score';
import { isItemKey, parseItemKey } from '@/lib/recommendations/item-keys';
import type { Candidate } from '@/lib/recommendations/rec-types';

function profileFixture(overrides: Partial<TasteProfile> = {}): TasteProfile {
  const profile = emptyTasteProfile('2026-07-16T00:00:00.000Z');
  profile.movie.genres = { 'science fiction': 1, thriller: 0.7 };
  profile.movie.signalMass = 10;
  return { ...profile, ...overrides };
}

function candidate(overrides: Partial<Candidate>): Candidate {
  return {
    itemKey: 'tmdb:movie:1',
    mediaType: 'movie',
    tmdbId: 1,
    title: 'Fixture',
    year: 2021,
    posterUrl: null,
    backdropUrl: null,
    rating: 7.5,
    voteCount: 500,
    popularity: 50,
    runtimeMin: 115,
    genres: ['Science Fiction'],
    overview: null,
    owned: false,
    href: '/discover/movie/1',
    source: 'tmdb',
    ...overrides,
  };
}

describe('scoreCandidates', () => {
  it('ranks profile-matching genres above mismatches', () => {
    const scored = scoreCandidates([
      candidate({ itemKey: 'tmdb:movie:1', genres: ['Science Fiction'] }),
      candidate({ itemKey: 'tmdb:movie:2', tmdbId: 2, genres: ['Romance'] }),
    ], { profile: profileFixture() });
    expect(scored[0].itemKey).toBe('tmdb:movie:1');
    expect(scored[0].score).toBeGreaterThan(scored[1].score);
  });

  it('hard-excludes not_interested and watched titles', () => {
    const profile = profileFixture();
    profile.negatives.excludedItemKeys = ['tmdb:movie:1'];
    profile.watchedItemKeys = ['tmdb:movie:2'];
    const scored = scoreCandidates([
      candidate({ itemKey: 'tmdb:movie:1' }),
      candidate({ itemKey: 'tmdb:movie:2', tmdbId: 2 }),
      candidate({ itemKey: 'tmdb:movie:3', tmdbId: 3 }),
      candidate({ itemKey: 'tmdb:movie:4', tmdbId: 4, watch: { played: true } }),
    ], { profile });
    expect(scored.map((c) => c.itemKey)).toEqual(['tmdb:movie:3']);
  });

  it('keeps watched titles when excludeWatched is off (rewatch surfaces)', () => {
    const profile = profileFixture();
    profile.watchedItemKeys = ['tmdb:movie:2'];
    const scored = scoreCandidates(
      [candidate({ itemKey: 'tmdb:movie:2', tmdbId: 2 })],
      { profile, excludeWatched: false }
    );
    expect(scored).toHaveLength(1);
  });

  it('impression fatigue and disliked genres push scores down', () => {
    const clean = profileFixture();
    const fatigued = profileFixture();
    fatigued.fatigue.seenWithoutClick = { 'tmdb:movie:1': 4 };
    fatigued.negatives.dislikedGenres = { 'science fiction': 1 };
    const [freshScore] = scoreCandidates([candidate({})], { profile: clean });
    const [tiredScore] = scoreCandidates([candidate({})], { profile: fatigued });
    expect(tiredScore.score).toBeLessThan(freshScore.score);
  });

  it('multi-seed boost outranks a plain quality match', () => {
    const scored = scoreCandidates([
      candidate({ itemKey: 'tmdb:movie:1', seedBoost: 1.4, seedTitles: ['A', 'B'] }),
      candidate({ itemKey: 'tmdb:movie:2', tmdbId: 2, rating: 9, voteCount: 5000 }),
    ], { profile: profileFixture() });
    expect(scored[0].itemKey).toBe('tmdb:movie:1');
  });
});

describe('selectRailItems', () => {
  it('is deterministic for the same rng seed and diversifies lead genres', () => {
    const profile = profileFixture();
    profile.movie.genres = { thriller: 1, comedy: 0.9, drama: 0.85 };
    const pool = [
      ...Array.from({ length: 10 }, (_, i) =>
        candidate({ itemKey: `tmdb:movie:${i + 1}`, tmdbId: i + 1, genres: ['Thriller'], rating: 8 })),
      ...Array.from({ length: 5 }, (_, i) =>
        candidate({ itemKey: `tmdb:movie:${i + 100}`, tmdbId: i + 100, genres: ['Comedy'], rating: 7.9 })),
    ];
    const scored = scoreCandidates(pool, { profile });

    const first = selectRailItems(scored, { limit: 10, rng: seededRng(hashSeed('u1:2026-07-16')), profile });
    const second = selectRailItems(scored, { limit: 10, rng: seededRng(hashSeed('u1:2026-07-16')), profile });
    expect(first.map((c) => c.itemKey)).toEqual(second.map((c) => c.itemKey)); // deterministic

    const comedyCount = first.filter((c) => c.genres.includes('Comedy')).length;
    expect(comedyCount).toBeGreaterThan(0); // diversity damping mixed the second genre in
  });

  it('fills exploration slots with high-quality out-of-profile picks and tags them', () => {
    const profile = profileFixture(); // likes sci-fi/thriller only
    const pool = [
      ...Array.from({ length: 12 }, (_, i) =>
        candidate({ itemKey: `tmdb:movie:${i + 1}`, tmdbId: i + 1, genres: ['Science Fiction'], rating: 7 })),
      candidate({ itemKey: 'tmdb:movie:200', tmdbId: 200, genres: ['Documentary'], rating: 9, voteCount: 2000 }),
    ];
    const scored = scoreCandidates(pool, { profile });
    const picked = selectRailItems(scored, {
      limit: 10,
      explorationRatio: 0.2,
      rng: seededRng(1),
      profile,
    });
    const explorer = picked.find((c) => c.exploration);
    expect(explorer?.itemKey).toBe('tmdb:movie:200');
  });
});

describe('franchiseKey', () => {
  it('collapses sequels and event specials into one fingerprint', () => {
    expect(franchiseKey('WrestleMania 37: Night 1')).toBe(franchiseKey('WWE WrestleMania XXIV'));
    expect(franchiseKey('Star Trek Beyond')).toBe(franchiseKey('Star Trek: The Motion Picture'));
    expect(franchiseKey('Dune: Part Two')).not.toBe(franchiseKey('Interstellar'));
  });

  it('keeps one franchise entry dominant per rail instead of five', () => {
    const profile = profileFixture();
    const pool = [
      ...Array.from({ length: 6 }, (_, i) =>
        candidate({ itemKey: `tmdb:movie:${i + 1}`, tmdbId: i + 1, title: `WrestleMania ${30 + i}`, genres: ['Science Fiction'], rating: 8.2, voteCount: 60 })),
      ...['Arrival', 'Moon', 'Sunshine', 'Coherence', 'Primer', 'Annihilation'].map((title, i) =>
        candidate({ itemKey: `tmdb:movie:${i + 50}`, tmdbId: i + 50, title, genres: ['Science Fiction'], rating: 7, voteCount: 800 })),
    ];
    const scored = scoreCandidates(pool, { profile });
    const picked = selectRailItems(scored, { limit: 8, rng: seededRng(1), profile, explorationRatio: 0 });
    const wrestle = picked.filter((c) => c.title.startsWith('WrestleMania')).length;
    expect(wrestle).toBeLessThanOrEqual(2);
  });
});

describe('item keys', () => {
  it('accepts every canonical form', () => {
    expect(parseItemKey('tmdb:movie:603')).toEqual({ mediaType: 'movie', tmdbId: 603 });
    expect(parseItemKey('tmdb:tv:1399')).toEqual({ mediaType: 'tv', tmdbId: 1399 });
    expect(parseItemKey('anilist:21')).toEqual({ mediaType: 'anime', anilistId: 21 });
    expect(parseItemKey('arr:radarr:cmf123abc:42')).toEqual({ mediaType: 'movie' });
    expect(parseItemKey('jf:a1b2c3')).toEqual({ mediaType: null });
  });

  it('rejects malformed keys', () => {
    for (const bad of ['tmdb:movie:', 'tmdb:person:5', 'anilist:x', 'movie:5', '', 'tmdb:movie:99999999999', "jf:'; DROP"]) {
      expect(isItemKey(bad), bad).toBe(false);
    }
  });
});
