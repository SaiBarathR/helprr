import { describe, expect, it } from 'vitest';
import { cueBottomPercent } from '@/lib/jellyfin-playback/subtitle-appearance';

/**
 * The percentage a cue box's bottom edge is pinned to so it clears the player
 * chrome. Numbers here are the geometries actually measured on the installed
 * Android PWA, where the row-counted placement failed.
 */
describe('cueBottomPercent', () => {
  it('clears the 101px chrome on a portrait phone', () => {
    expect(cueBottomPercent(876, 101)).toBeCloseTo(88.47, 2);
  });

  it('clears it in landscape, where the chrome is a third of the viewport', () => {
    // 350px tall: rows reserved from the bottom put a plain two-line cue under
    // the seek bar, which is what made this worth fixing rather than tuning.
    expect(cueBottomPercent(350, 116)).toBeCloseTo(66.86, 2);
  });

  it('scales with an open panel, which grows the chrome upward', () => {
    // Subtitle track list open: 301px of the same 876px box.
    expect(cueBottomPercent(876, 301)).toBeCloseTo(65.64, 2);
  });

  it('yields null when there is nothing to clear, keeping row placement', () => {
    expect(cueBottomPercent(876, 0)).toBeNull();
    expect(cueBottomPercent(876, -20)).toBeNull();
  });

  it('yields null for a video box that has not been laid out', () => {
    expect(cueBottomPercent(0, 101)).toBeNull();
    expect(cueBottomPercent(Number.NaN, 101)).toBeNull();
    expect(cueBottomPercent(876, Number.NaN)).toBeNull();
  });

  it('pins to the top rather than under the controls when chrome fills the box', () => {
    expect(cueBottomPercent(200, 200)).toBe(0);
    expect(cueBottomPercent(200, 260)).toBe(0);
  });
});
