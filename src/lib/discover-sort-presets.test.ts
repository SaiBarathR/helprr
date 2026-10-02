import { describe, expect, it } from 'vitest';
import { discoverSortPresetNote } from './discover-sort-presets';

describe('discoverSortPresetNote', () => {
  it('names the vote floor behind the rating presets', () => {
    expect(discoverSortPresetNote('highlyRated', '', null)).toBe('Only titles with 200+ votes');
    expect(discoverSortPresetNote('mostLoved', '', null)).toBe('Only titles with 1,200+ votes');
  });

  it('drops the floor once the vote filter already asks for as many', () => {
    expect(discoverSortPresetNote('highlyRated', '500', null)).toBeNull();
    expect(discoverSortPresetNote('mostLoved', '500', null)).toBe('Only titles with 1,200+ votes');
  });

  it('says Upcoming leaves out released titles', () => {
    expect(discoverSortPresetNote('upcoming', '', null)).toBe('Only titles that are not out yet');
  });

  it('adds nothing for sorts without hidden rules', () => {
    expect(discoverSortPresetNote('trending', '', null)).toBeNull();
    expect(discoverSortPresetNote('popular', '', null)).toBeNull();
  });

  it('adds nothing for sections served from fixed TMDB lists', () => {
    expect(discoverSortPresetNote('highlyRated', '', 'top_rated_movies')).toBeNull();
    expect(discoverSortPresetNote('upcoming', '', 'now_playing')).toBeNull();
  });
});
