import { describe, expect, it } from 'vitest';
import { composeRecommendations, type ComposeInput } from '@/lib/recommendations/compose-rails';
import { emptyTasteProfile, type TasteProfile } from '@/lib/recommendations/profile-types';
import type { Candidate, RecItem } from '@/lib/recommendations/rec-types';

function profileFixture(): TasteProfile {
  const profile = emptyTasteProfile('2026-07-16T00:00:00.000Z');
  profile.movie.genres = { thriller: 1, 'science fiction': 0.8 };
  profile.movie.signalMass = 12;
  profile.tv.genres = { drama: 0.9 };
  profile.tv.signalMass = 8;
  profile.seeds = [
    { itemKey: 'tmdb:tv:1399', mediaType: 'tv', tmdbId: 1399, title: 'Game of Thrones', weight: 1 },
  ];
  return profile;
}

let nextId = 1;
function candidate(overrides: Partial<Candidate>): Candidate {
  const id = nextId++;
  return {
    itemKey: `tmdb:movie:${id}`,
    mediaType: 'movie',
    tmdbId: id,
    title: `Movie ${id}`,
    year: 2022,
    posterUrl: null,
    backdropUrl: null,
    rating: 7,
    voteCount: 300,
    popularity: 40,
    runtimeMin: 110,
    genres: ['Thriller'],
    overview: null,
    owned: false,
    href: `/discover/movie/${id}`,
    source: 'tmdb',
    ...overrides,
  };
}

function ownedCandidate(overrides: Partial<Candidate> = {}): Candidate {
  const base = candidate(overrides);
  return {
    ...base,
    owned: true,
    source: 'library',
    arr: { scope: 'radarr', instanceId: 'inst1', id: base.tmdbId ?? 1 },
    addedAt: '2026-07-10T00:00:00.000Z',
    ...overrides,
  };
}

function composeInput(overrides: Partial<ComposeInput> = {}): ComposeInput {
  return {
    profile: profileFixture(),
    library: [],
    discovery: [],
    anime: [],
    continueWatching: [],
    watchlistItemKeys: new Set(),
    liveExcludedItemKeys: new Set(),
    now: new Date('2026-07-16T20:00:00Z'),
    localHour: 20,
    rngSeed: 'user1:2026-07-16',
    ...overrides,
  };
}

describe('composeRecommendations', () => {
  it('builds top-picks from owned unwatched titles and a discover rail from discovery', () => {
    const library = Array.from({ length: 8 }, () => ownedCandidate());
    const discovery = Array.from({ length: 8 }, () => candidate({}));
    const { rails } = composeRecommendations(composeInput({ library, discovery }));

    const ids = rails.map((r) => r.id);
    expect(ids).toContain('top-picks');
    expect(ids).toContain('discover');
    const topPicks = rails.find((r) => r.id === 'top-picks')!;
    expect(topPicks.items.every((i) => i.owned)).toBe(true);
  });

  it('passes continue-watching through untouched at the front', () => {
    const cw: RecItem[] = [{
      itemKey: 'tmdb:movie:900',
      mediaType: 'movie',
      tmdbId: 900,
      title: 'Halfway There',
      year: 2021,
      posterUrl: null,
      backdropUrl: null,
      rating: 7,
      runtimeMin: 100,
      genres: [],
      overview: null,
      owned: true,
      href: '/movies/1?instance=inst1',
      source: 'library',
      reason: 'Pick up where you left off',
      watch: { played: false, progressPct: 45 },
    }];
    const { rails } = composeRecommendations(composeInput({ continueWatching: cw }));
    expect(rails[0]?.id).toBe('continue-watching');
    expect(rails[0]?.items).toEqual(cw);
  });

  it('creates a "Because you watched" rail from seed-tagged discovery', () => {
    const discovery = Array.from({ length: 6 }, () =>
      candidate({ mediaType: 'tv', genres: ['Drama'], seedTitles: ['Game of Thrones'], seedBoost: 1 }));
    // Re-key as tv so itemKeys don't clash with movie fixtures elsewhere.
    discovery.forEach((c, i) => {
      c.itemKey = `tmdb:tv:${5000 + i}`;
      c.tmdbId = 5000 + i;
    });
    const { rails } = composeRecommendations(composeInput({ discovery }));
    const because = rails.find((r) => r.id === 'because:tmdb:tv:1399');
    expect(because?.title).toBe('Because you watched Game of Thrones');
    expect(because?.items.length).toBeGreaterThanOrEqual(4);
  });

  it('live liked keys boost an item on the very next compose', () => {
    const favorite = candidate({ genres: ['Romance'] }); // out-of-profile genre
    const rivals = Array.from({ length: 10 }, () => candidate({ genres: ['Thriller'] }));
    const withoutLike = composeRecommendations(composeInput({ discovery: [favorite, ...rivals] }));
    const withLike = composeRecommendations(composeInput({
      discovery: [favorite, ...rivals],
      liveLikedItemKeys: new Set([favorite.itemKey]),
    }));
    const rank = (result: typeof withLike) =>
      result.rails.find((r) => r.id === 'discover')!.items.findIndex((i) => i.itemKey === favorite.itemKey);
    expect(rank(withLike)).toBeGreaterThanOrEqual(0);
    expect(rank(withLike)).toBeLessThan(rank(withoutLike) === -1 ? Number.MAX_SAFE_INTEGER : rank(withoutLike));
  });

  it('live excludes remove items everywhere immediately', () => {
    const victim = candidate({});
    const discovery = [victim, ...Array.from({ length: 7 }, () => candidate({}))];
    const { rails, feed } = composeRecommendations(composeInput({
      discovery,
      liveExcludedItemKeys: new Set([victim.itemKey]),
    }));
    const everywhere = [...rails.flatMap((r) => r.items), ...feed];
    expect(everywhere.some((i) => i.itemKey === victim.itemKey)).toBe(false);
  });

  it('surfaces watched-but-owned titles nowhere in top-picks (they belong to continue watching)', () => {
    const watched = ownedCandidate({ watch: { played: true, progressPct: 100 } });
    const fresh = Array.from({ length: 6 }, () => ownedCandidate({ watch: { played: false } }));
    const { rails } = composeRecommendations(composeInput({ library: [watched, ...fresh] }));
    const topPicks = rails.find((r) => r.id === 'top-picks')!;
    expect(topPicks.items.some((i) => i.itemKey === watched.itemKey)).toBe(false);
  });

  it('builds a mood rail for the current daypart when mood data exists', () => {
    const profile = profileFixture();
    profile.moods.genresByDaypart.evening = { thriller: 1 };
    profile.moods.dayparts.evening = 0.8;
    const discovery = Array.from({ length: 8 }, () => candidate({ genres: ['Thriller'] }));
    const { rails } = composeRecommendations(composeInput({ profile, discovery, localHour: 20 }));
    const mood = rails.find((r) => r.id === 'mood:evening');
    expect(mood).toBeDefined();
    expect(mood?.title).toContain('Tonight');
  });

  it('feed is deterministic for a seed, deduped, and mixes sources', () => {
    const library = Array.from({ length: 10 }, () => ownedCandidate());
    const discovery = Array.from({ length: 10 }, () => candidate({}));
    const first = composeRecommendations(composeInput({ library, discovery }));
    const second = composeRecommendations(composeInput({ library, discovery }));
    expect(first.feed.map((i) => i.itemKey)).toEqual(second.feed.map((i) => i.itemKey));
    const keys = first.feed.map((i) => i.itemKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(first.feed.some((i) => i.owned)).toBe(true);
    expect(first.feed.some((i) => !i.owned)).toBe(true);
  });
});
