import { describe, expect, it } from 'vitest';
import {
  buildTasteProfile,
  daypartOf,
  engagementWeight,
  type BuildProfileInput,
  type EngagedTitleSignal,
} from '@/lib/recommendations/build-profile';

const NOW = new Date('2026-07-16T20:00:00Z');

const SOURCES = {
  jellyfin: true,
  playbackReporting: false,
  anilist: false,
  watchlist: false,
  events: false,
};

function title(overrides: Partial<EngagedTitleSignal>): EngagedTitleSignal {
  return {
    itemKey: 'tmdb:movie:1',
    mediaType: 'movie',
    tmdbId: 1,
    title: 'Fixture',
    genres: ['Action'],
    year: 2020,
    runtimeMin: 110,
    playCount: 1,
    lastPlayedAt: NOW.toISOString(),
    fullyWatched: true,
    favorite: false,
    ratingNorm: null,
    ...overrides,
  };
}

function input(overrides: Partial<BuildProfileInput>): BuildProfileInput {
  return {
    now: NOW,
    engagedTitles: [],
    plays: [],
    playsFromPlaybackReporting: false,
    events: {
      positives: [],
      negatives: [],
      excludedItemKeys: [],
      likedItemKeys: [],
      impressionsWithoutClick: [],
    },
    watchlist: [],
    sources: SOURCES,
    ...overrides,
  };
}

describe('buildTasteProfile', () => {
  it('weights recent watches above old ones in the genre vector', () => {
    const profile = buildTasteProfile(input({
      engagedTitles: [
        title({ itemKey: 'tmdb:movie:1', tmdbId: 1, genres: ['Comedy'], lastPlayedAt: NOW.toISOString() }),
        title({
          itemKey: 'tmdb:movie:2',
          tmdbId: 2,
          genres: ['Horror'],
          lastPlayedAt: new Date(NOW.getTime() - 300 * 86_400_000).toISOString(),
        }),
      ],
    }));
    expect(profile.movie.genres.comedy).toBe(1);
    expect(profile.movie.genres.horror).toBeLessThan(0.05);
  });

  it('ranks seeds by engagement and drops hard-excluded ones', () => {
    const profile = buildTasteProfile(input({
      engagedTitles: [
        title({ itemKey: 'tmdb:movie:1', tmdbId: 1, title: 'Loved', playCount: 6, favorite: true }),
        title({ itemKey: 'tmdb:movie:2', tmdbId: 2, title: 'Fine', playCount: 1 }),
        title({ itemKey: 'tmdb:movie:3', tmdbId: 3, title: 'Blocked', playCount: 9 }),
      ],
      events: {
        positives: [],
        negatives: [],
        excludedItemKeys: ['tmdb:movie:3'],
        likedItemKeys: [],
        impressionsWithoutClick: [],
      },
    }));
    expect(profile.seeds[0].title).toBe('Loved');
    expect(profile.seeds[0].weight).toBe(1);
    expect(profile.seeds.map((s) => s.itemKey)).not.toContain('tmdb:movie:3');
  });

  it('a low explicit rating drags a title below an unrated one', () => {
    const loved = engagementWeight(title({ ratingNorm: 1 }));
    const unrated = engagementWeight(title({ ratingNorm: null }));
    const hated = engagementWeight(title({ ratingNorm: 0.1 }));
    expect(loved).toBeGreaterThan(unrated);
    expect(hated).toBeLessThan(unrated);
  });

  it('collects fully watched keys and permanent excludes', () => {
    const profile = buildTasteProfile(input({
      engagedTitles: [
        title({ itemKey: 'tmdb:movie:1', fullyWatched: true }),
        title({ itemKey: 'tmdb:movie:2', tmdbId: 2, fullyWatched: false, playCount: 1 }),
      ],
      events: {
        positives: [],
        negatives: [],
        excludedItemKeys: ['tmdb:tv:9'],
        likedItemKeys: ['tmdb:movie:5'],
        impressionsWithoutClick: [],
      },
    }));
    expect(profile.watchedItemKeys).toEqual(['tmdb:movie:1']);
    expect(profile.negatives.excludedItemKeys).toEqual(['tmdb:tv:9']);
    expect(profile.likedItemKeys).toEqual(['tmdb:movie:5']);
  });

  it('accumulates impression fatigue per item and decays negatives into genre penalties', () => {
    const profile = buildTasteProfile(input({
      events: {
        positives: [],
        negatives: [
          { itemKey: 'tmdb:movie:9', genres: ['Romance'], at: NOW.toISOString() },
        ],
        excludedItemKeys: ['tmdb:movie:9'],
        likedItemKeys: [],
        impressionsWithoutClick: [
          { itemKey: 'tmdb:movie:7', at: NOW.toISOString() },
          { itemKey: 'tmdb:movie:7', at: NOW.toISOString() },
        ],
      },
    }));
    expect(profile.fatigue.seenWithoutClick['tmdb:movie:7']).toBeCloseTo(2, 1);
    expect(profile.negatives.dislikedGenres.romance).toBe(1);
  });

  it('builds daypart mood vectors from the play stream', () => {
    const evening = new Date('2026-07-15T20:30:00');
    const morning = new Date('2026-07-15T08:30:00');
    const profile = buildTasteProfile(input({
      plays: [
        { at: evening.toISOString(), genres: ['Thriller'] },
        { at: evening.toISOString(), genres: ['Thriller'] },
        { at: morning.toISOString(), genres: ['Comedy'] },
      ],
      playsFromPlaybackReporting: true,
    }));
    // Timestamps parse in the host timezone, so assert via the same path.
    const eveningPart = daypartOf(new Date(evening.toISOString()).getHours());
    const morningPart = daypartOf(new Date(morning.toISOString()).getHours());
    expect(profile.moods.dayparts[eveningPart]).toBeGreaterThan(profile.moods.dayparts[morningPart]);
    expect(profile.moods.genresByDaypart[eveningPart]?.thriller).toBe(1);
    expect(profile.moods.fromPlaybackReporting).toBe(true);
  });
});
