import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ cached: vi.fn() }));

vi.mock('@/lib/cache/anilist-api-cache', () => ({ getAnilistJsonWithCache: mocks.cached }));
vi.mock('@/lib/cache/state', () => ({
  getAnilistTtlSettings: vi.fn(async () => ({ sectionsTtlMin: 5, browseTtlMin: 10, detailTtlMin: 1440, airingTtlMin: 10 })),
}));

import { browseAnime } from '@/lib/anilist-client';

/** The AniList variables of the last browse request. */
const sent = () => mocks.cached.mock.calls.at(-1)![0].params as Record<string, unknown>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 2)); // Fall 2026
  mocks.cached.mockResolvedValue({ Page: { pageInfo: {}, media: [] } });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Seasonal browse', () => {
  it('shows the current season and year when the filters pick neither', async () => {
    await browseAnime({ sort: 'seasonal' });
    expect(sent()).toMatchObject({ season: 'FALL', seasonYear: 2026 });
  });

  it('keeps a year range instead of intersecting it with this year', async () => {
    await browseAnime({ sort: 'seasonal', yearGreater: 2010, yearLesser: 2015 });
    expect(sent()).toMatchObject({ season: 'FALL', startDate_greater: 20100000, startDate_lesser: 20151231 });
    expect(sent()).not.toHaveProperty('seasonYear');

    await browseAnime({ sort: 'seasonal', yearLesser: 2015 });
    expect(sent()).not.toHaveProperty('seasonYear');
  });

  it('still uses an explicit year and season as given', async () => {
    await browseAnime({ sort: 'seasonal', year: 2019, season: 'SPRING' });
    expect(sent()).toMatchObject({ season: 'SPRING', seasonYear: 2019 });
  });

  it('adds no season defaults to other sorts', async () => {
    await browseAnime({ sort: 'popularity', yearGreater: 2010 });
    expect(sent()).not.toHaveProperty('season');
    expect(sent()).not.toHaveProperty('seasonYear');
  });
});
