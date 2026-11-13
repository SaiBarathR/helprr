import { describe, expect, it } from 'vitest';
import { isAlbumNotReleased } from '@/lib/album-release';

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
