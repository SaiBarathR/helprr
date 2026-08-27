import { describe, expect, it } from 'vitest';
import {
  targetTrailerHeight,
  targetTrailerQuality,
  trailerPlayerLayout,
  youtubeTrailerKey,
} from '@/lib/jellyfin-playback/youtube-embed';

describe('youtubeTrailerKey', () => {
  it.each([
    ['https://www.youtube.com/watch?v=Vm4tx1O9GAc', 'Vm4tx1O9GAc'],
    ['https://youtube.com/watch?v=Vm4tx1O9GAc&t=30', 'Vm4tx1O9GAc'],
    ['https://youtu.be/Vm4tx1O9GAc', 'Vm4tx1O9GAc'],
    ['https://m.youtube.com/watch?v=Vm4tx1O9GAc', 'Vm4tx1O9GAc'],
  ])('reads the key from %s', (url, key) => {
    expect(youtubeTrailerKey(url)).toBe(key);
  });

  it.each<[string | undefined, string]>([
    ['https://vimeo.com/12345', 'a non-YouTube host'],
    ['https://www.dailymotion.com/video/x8abcde', 'Dailymotion, which has no player API'],
    ['not a url', 'an unparseable value'],
    ['https://www.youtube.com/watch', 'a URL with no key'],
    [undefined, 'a missing trailer'],
  ])('returns null for %s (%s)', (url) => {
    expect(youtubeTrailerKey(url)).toBeNull();
  });
});

describe('targetTrailerQuality', () => {
  it.each([
    [375, 'large', 480],
    [767, 'large', 480],
    [768, 'hd720', 720],
    [1279, 'hd720', 720],
    [1280, 'hd1080', 1080],
    [2560, 'hd1080', 1080],
  ])('asks for %s-wide viewports: %s (%ip)', (width, quality, height) => {
    expect(targetTrailerQuality(width)).toBe(quality);
    expect(targetTrailerHeight(width)).toBe(height);
  });

  it('never drops a tablet or desktop below 720p', () => {
    for (const width of [768, 900, 1024, 1280, 1440, 1920]) {
      expect(targetTrailerHeight(width)).toBeGreaterThanOrEqual(720);
    }
  });
});

/** Kept in step with TRAILER_OVERSCAN; the crop hides provider chrome. */
const OVERSCAN = 1.18;

describe('trailerPlayerLayout', () => {
  it('covers a frame wider than 16:9 by driving from its width', () => {
    // 2000x500 is wider than 16:9, so matching the width covers it and the
    // extra height overflows the frame, which clips it.
    const layout = trailerPlayerLayout(2000, 500, 480);

    expect(layout.width / layout.height).toBeCloseTo(16 / 9, 2);
    expect(layout.width * layout.scale).toBeCloseTo(2000 * OVERSCAN, 0);
    expect(layout.height * layout.scale).toBeGreaterThanOrEqual(500);
  });

  it('covers a frame taller than 16:9 by driving from its height', () => {
    // A phone hero: 375x650 needs a far wider player to avoid pillarboxing.
    const layout = trailerPlayerLayout(375, 650, 480);

    expect(layout.width / layout.height).toBeCloseTo(16 / 9, 2);
    expect(layout.width * layout.scale).toBeGreaterThanOrEqual(375);
    expect(layout.height * layout.scale).toBeCloseTo(650 * OVERSCAN, 0);
  });

  it('lays the player out at the target rendition so YouTube serves it', () => {
    // The bug this fixes: a 560px-tall hero got offered ~360p, then the old
    // code magnified it 2.2x. Laying out at 1080 asks for 1080p instead.
    const layout = trailerPlayerLayout(1440, 560, 1080);

    expect(layout.height).toBeGreaterThanOrEqual(1080);
    // ...and scaled back down, never up. The displayed box is the cover box
    // (1440x810 here), which overflows the 560px frame and is clipped — that
    // overflow is what "cover" means, and it is not extra magnification.
    expect(layout.scale).toBeLessThan(1);
    expect(layout.width * layout.scale).toBeCloseTo(1440 * OVERSCAN, 0);
    expect(layout.height * layout.scale).toBeCloseTo(810 * OVERSCAN, 0);
  });

  it('never lays the player out smaller than it displays', () => {
    // A frame already larger than the target must not be downsampled.
    const layout = trailerPlayerLayout(3840, 2160, 720);

    expect(layout.scale).toBe(1);
    expect(layout.width).toBeGreaterThanOrEqual(3840);
  });

  it('always overscans a little, so provider chrome falls outside the frame', () => {
    // The title/channel overlay sits on the top edge and the progress strip on
    // the bottom; both must land outside the visible frame.
    const layout = trailerPlayerLayout(1440, 810, 720);

    expect(layout.height * layout.scale).toBeGreaterThan(810);
    expect(layout.width * layout.scale).toBeGreaterThan(1440);
  });

  it('is inert for an unmeasured frame', () => {
    expect(trailerPlayerLayout(0, 0, 1080)).toEqual({ width: 0, height: 0, scale: 1 });
  });
});
