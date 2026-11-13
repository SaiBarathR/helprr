import { describe, expect, it } from 'vitest';
import { isFilmNotReleased, nextFilmRelease } from '@/lib/film-releases';

describe('nextFilmRelease', () => {
  const now = Date.parse('2026-11-13T12:00:00Z');

  it('is the soonest release still to come, with its label', () => {
    const film = { inCinemas: '2026-10-01T00:00:00Z', digitalRelease: '2026-12-20T00:00:00Z', physicalRelease: '2027-02-01T00:00:00Z' };
    expect(nextFilmRelease(film, now)).toEqual({ label: 'Digital release', date: new Date('2026-12-20T00:00:00Z') });
  });

  it('is null for a film with nothing ahead, or no dates at all', () => {
    expect(nextFilmRelease({ digitalRelease: '2026-01-01T00:00:00Z' }, now)).toBeNull();
    // Announced with no date: not out, but no date to show.
    expect(isFilmNotReleased({ status: 'announced' }, now)).toBe(true);
    expect(nextFilmRelease({ status: 'announced' }, now)).toBeNull();
  });
});
