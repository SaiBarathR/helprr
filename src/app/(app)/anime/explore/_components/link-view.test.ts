import { describe, expect, it } from 'vitest';
import { DEFAULT_ANIME_FILTERS } from '@/lib/store';
import { exploreHref, exploreLinkView } from './link-view';

const link = (query: string) => exploreLinkView(new URLSearchParams(query));

describe('exploreLinkView', () => {
  it('is null for a plain or search-only visit', () => {
    expect(link('')).toBeNull();
    expect(link('search=frieren')).toBeNull();
  });

  it('starts a link from the default filters', () => {
    expect(link('sort=trending')).toEqual({ sort: 'trending', filters: DEFAULT_ANIME_FILTERS });
    expect(link('season=FALL&year=2026&format=TV,MOVIE&genres=Action')).toEqual({
      sort: 'seasonal',
      filters: { ...DEFAULT_ANIME_FILTERS, season: 'FALL', year: '2026', formats: ['TV', 'MOVIE'], genres: ['Action'] },
    });
  });
});

describe('exploreHref', () => {
  it('keeps a link a link after its filters are removed', () => {
    const href = exploreHref('/anime/explore', { sort: 'seasonal', filters: DEFAULT_ANIME_FILTERS }, '');
    expect(href).toBe('/anime/explore?sort=seasonal');
    expect(link(href.split('?')[1])).not.toBeNull();
  });

  it('round-trips a link view and keeps the search next to it', () => {
    const view = { sort: 'score', filters: { ...DEFAULT_ANIME_FILTERS, status: 'RELEASING', genres: ['Drama'] } };
    const href = exploreHref('/anime/explore', view, 'frieren');
    expect(href).toBe('/anime/explore?sort=score&status=RELEASING&genres=Drama&search=frieren');
    expect(link(href.split('?')[1])).toEqual(view);
  });

  it('writes only the search for a plain visit', () => {
    expect(exploreHref('/anime/explore', null, '')).toBe('/anime/explore');
    expect(exploreHref('/anime/explore', null, 'frieren')).toBe('/anime/explore?search=frieren');
  });
});
