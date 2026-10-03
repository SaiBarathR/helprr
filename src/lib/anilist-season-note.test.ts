import { describe, expect, it } from 'vitest';
import { getCurrentSeason, seasonalSortNote } from './anilist-helpers';

const october = new Date(2026, 9, 2);

describe('seasonalSortNote', () => {
  it('names the current season when the filters pick none', () => {
    expect(seasonalSortNote({ season: '', year: '' }, october)).toBe('Only anime from Fall 2026');
  });

  it('fills in only the part the filters leave out', () => {
    expect(seasonalSortNote({ season: 'SPRING', year: '' }, october)).toBe('Only anime from Spring 2026');
    expect(seasonalSortNote({ season: '', year: '2019' }, october)).toBe('Only anime from Fall 2019');
  });

  it('adds nothing once the filters pick both, since their chips say it', () => {
    expect(seasonalSortNote({ season: 'WINTER', year: '2024' }, october)).toBeNull();
  });
});

describe('getCurrentSeason', () => {
  it('maps months to AniList seasons', () => {
    expect(getCurrentSeason(new Date(2026, 0, 15))).toEqual({ season: 'WINTER', year: 2026 });
    expect(getCurrentSeason(new Date(2026, 3, 1))).toEqual({ season: 'SPRING', year: 2026 });
    expect(getCurrentSeason(new Date(2026, 8, 30))).toEqual({ season: 'SUMMER', year: 2026 });
    expect(getCurrentSeason(october)).toEqual({ season: 'FALL', year: 2026 });
  });
});
