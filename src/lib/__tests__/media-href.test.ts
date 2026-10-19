import { describe, expect, it } from 'vitest';
import { getMediaHrefFromIds } from '@/lib/media-href';

describe('getMediaHrefFromIds', () => {
  it('opens a film, an album or an artist, in that order, on the event\'s instance', () => {
    expect(getMediaHrefFromIds({ movieId: 12, seriesId: 4, instanceId: 'i2' })).toBe('/movies/12?instance=i2');
    expect(getMediaHrefFromIds({ albumId: '3', artistId: 8 })).toBe('/music/album/3');
    expect(getMediaHrefFromIds({ artistId: 8, instanceId: '' })).toBe('/music/8');
  });

  it('opens the most specific series page it has ids for', () => {
    expect(getMediaHrefFromIds({ seriesId: 4, seasonNumber: 2, episodeId: 9 })).toBe('/series/4/season/2/episode/9');
    expect(getMediaHrefFromIds({ seriesId: '4', seasonNumber: '2' })).toBe('/series/4/season/2');
    expect(getMediaHrefFromIds({ seriesId: 4, episodeId: 9 })).toBe('/series/4');
    expect(getMediaHrefFromIds({ seriesId: 4, seasonNumber: 'x', episodeId: 9 })).toBe('/series/4');
  });

  it('opens a special (season 0) like any other episode', () => {
    expect(getMediaHrefFromIds({ seriesId: 4, seasonNumber: 0, episodeId: 9, instanceId: 'i2' })).toBe('/series/4/season/0/episode/9?instance=i2');
    expect(getMediaHrefFromIds({ seriesId: 4, seasonNumber: '0' })).toBe('/series/4/season/0');
  });

  it('has nothing to open without an id', () => {
    expect(getMediaHrefFromIds({})).toBeNull();
    expect(getMediaHrefFromIds({ seasonNumber: 1, episodeId: 9 })).toBeNull();
    expect(getMediaHrefFromIds({ movieId: 0, seriesId: '' })).toBeNull();
  });
});
