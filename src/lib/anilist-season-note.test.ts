import { describe, expect, it } from 'vitest';
import { getCurrentSeason, orderYearRange, seasonalSortNote } from './anilist-helpers';

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
    expect(seasonalSortNote({ season: 'WINTER', year: '', yearMin: '2010', yearMax: '2015' }, october)).toBeNull();
  });

  it('keeps a year range instead of this year', () => {
    expect(seasonalSortNote({ season: '', year: '', yearMin: '2010', yearMax: '2015' }, october)).toBe('Only Fall anime from 2010–2015');
    expect(seasonalSortNote({ season: '', year: '', yearMin: '2010', yearMax: '' }, october)).toBe('Only Fall anime from 2010 onward');
    expect(seasonalSortNote({ season: 'SPRING', year: '', yearMin: '', yearMax: '2015' }, october)).toBeNull();
    expect(seasonalSortNote({ season: '', year: '', yearMin: '', yearMax: '2015' }, october)).toBe('Only Fall anime up to 2015');
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

describe('orderYearRange', () => {
  const filters = { genres: [], year: '', season: '', formats: [], status: '' };

  it('puts a range picked high to low in order', () => {
    expect(orderYearRange({ ...filters, yearMin: '2020', yearMax: '2010' })).toMatchObject({ yearMin: '2010', yearMax: '2020' });
  });

  it('leaves an ordered range or a single bound as it is', () => {
    const ordered = { ...filters, yearMin: '2010', yearMax: '2015' };
    expect(orderYearRange(ordered)).toBe(ordered);
    const single = { ...filters, yearMin: '2020', yearMax: '' };
    expect(orderYearRange(single)).toBe(single);
  });
});
