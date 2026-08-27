import { describe, expect, it } from 'vitest';
import { activeLyricIndex, normalizeJellyfinLyrics } from '@/lib/jellyfin-playback/lyrics';

describe('jellyfin lyrics', () => {
  it('normalizes timed lyric DTOs from Jellyfin 10.11', () => {
    const lines = normalizeJellyfinLyrics({
      Lyrics: [
        { Text: 'Hello', Start: 0 },
        { Text: 'World', Start: 20_000_000 },
      ],
    });
    expect(lines).toEqual([
      { text: 'Hello', startSeconds: 0 },
      { text: 'World', startSeconds: 2 },
    ]);
    expect(activeLyricIndex(lines, 1.5)).toBe(0);
    expect(activeLyricIndex(lines, 2)).toBe(1);
  });

  it('accepts plain-text lyrics', () => {
    expect(normalizeJellyfinLyrics('one\ntwo')).toEqual([
      { text: 'one', startSeconds: null },
      { text: 'two', startSeconds: null },
    ]);
  });
});
