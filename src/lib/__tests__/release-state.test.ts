import { describe, expect, it } from 'vitest';
import { artistTrackState, isAlbumNotReleased, isEpisodeNotAired } from '@/lib/release-state';

describe('isAlbumNotReleased', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');

  it('is true only for an album dated ahead', () => {
    expect(isAlbumNotReleased({ releaseDate: '2026-11-28T00:00:00Z' }, now)).toBe(true);
    expect(isAlbumNotReleased({ releaseDate: '2026-11-13T00:00:00Z' }, now)).toBe(false);
    expect(isAlbumNotReleased({ releaseDate: '1969-01-01T00:00:00Z' }, now)).toBe(false);
  });

  it('is false with no date, as nothing says it is ahead', () => {
    expect(isAlbumNotReleased({}, now)).toBe(false);
    expect(isAlbumNotReleased({ releaseDate: null }, now)).toBe(false);
  });
});

describe('isEpisodeNotAired', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');

  it('is true for an episode airing later or with no air time yet', () => {
    expect(isEpisodeNotAired({ airDateUtc: '2026-11-13T12:30:00Z' }, now)).toBe(true);
    expect(isEpisodeNotAired({}, now)).toBe(true);
    expect(isEpisodeNotAired({ airDateUtc: null }, now)).toBe(true);
  });

  it('is false once it has aired', () => {
    expect(isEpisodeNotAired({ airDateUtc: '2026-11-13T11:59:00Z' }, now)).toBe(false);
    expect(isEpisodeNotAired({ airDateUtc: '2022-06-27T09:00:00Z' }, now)).toBe(false);
    // Only a day known.
    expect(isEpisodeNotAired({ airDate: '2026-08-05' }, now)).toBe(false);
    expect(isEpisodeNotAired({ airDate: '2026-12-01' }, now)).toBe(true);
  });
});

describe('artistTrackState', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');
  const album = (releaseDate: string, trackFileCount: number, totalTrackCount = 10) => ({ releaseDate, statistics: { trackFileCount, totalTrackCount } });

  it('counts only albums already out', () => {
    // Every released album complete; the one ahead has nothing yet.
    expect(artistTrackState([album('2020-01-01', 10), album('2026-12-01', 0)], now)).toBe('complete');
    expect(artistTrackState([album('2020-01-01', 4), album('2026-12-01', 0)], now)).toBe('missing');
  });

  it('says an artist with nothing out yet is not released, not missing', () => {
    expect(artistTrackState([album('2026-12-01', 0), album('2027-03-01', 0)], now)).toBe('notReleased');
  });

  it('is missing when nothing is known', () => {
    expect(artistTrackState([], now)).toBe('missing');
    expect(artistTrackState([album('2020-01-01', 0, 0)], now)).toBe('missing');
  });
});
