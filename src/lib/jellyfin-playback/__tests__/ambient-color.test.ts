import { describe, expect, it } from 'vitest';
import { washColorFromPixels, washGradient } from '@/lib/jellyfin-playback/ambient-color';

/** Builds an RGBA buffer from a list of [r,g,b] triples, all fully opaque. */
function pixels(colors: Array<[number, number, number]>): Uint8ClampedArray {
  const data = new Uint8ClampedArray(colors.length * 4);
  colors.forEach(([r, g, b], index) => {
    data.set([r, g, b, 255], index * 4);
  });
  return data;
}

function hueOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return -1;
  const d = max - min;
  const h = max === r ? ((g - b) / d + (g < b ? 6 : 0)) : max === g ? ((b - r) / d + 2) : ((r - g) / d + 4);
  return Math.round((h / 6) * 360);
}

function lightnessOf(hex: string): number {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  return (Math.max(r, g, b) + Math.min(r, g, b)) / 2;
}

describe('washColorFromPixels', () => {
  it('keeps the hue of the artwork', () => {
    const blue = washColorFromPixels(pixels(Array(64).fill([40, 90, 160])));
    const red = washColorFromPixels(pixels(Array(64).fill([170, 45, 40])));

    expect(hueOf(blue)).toBeGreaterThan(180);
    expect(hueOf(blue)).toBeLessThan(260);
    expect(hueOf(red)).toBeLessThan(30);
  });

  it('always returns a dark ground, whatever the source brightness', () => {
    // A pale poster must not produce a wash that white text cannot sit on.
    for (const source of [[240, 230, 220], [40, 90, 160], [10, 20, 30]] as Array<[number, number, number]>) {
      const hex = washColorFromPixels(pixels(Array(32).fill(source)));
      expect(lightnessOf(hex)).toBeLessThan(0.2);
    }
  });

  it('lets one vivid region decide the hue over a grey majority', () => {
    // A plain mean would drown the accent and hand back a muddy neutral; the
    // saturation weighting is what keeps the wash keyed to the artwork.
    const mostlyGrey = Array<[number, number, number]>(60).fill([120, 120, 122]);
    const accent = Array<[number, number, number]>(12).fill([200, 30, 30]);
    const hex = washColorFromPixels(pixels([...mostlyGrey, ...accent]));

    const hue = hueOf(hex);
    expect(hue >= 340 || hue <= 30).toBe(true);
  });

  it('reports black for a frame with nothing to sample', () => {
    expect(washColorFromPixels(pixels(Array(16).fill([0, 0, 0])))).toBe('#000000');
    expect(washColorFromPixels(new Uint8ClampedArray(0))).toBe('#000000');
  });

  it('ignores fully transparent pixels', () => {
    const data = new Uint8ClampedArray(8);
    data.set([200, 30, 30, 0], 0);
    data.set([40, 90, 160, 255], 4);

    expect(hueOf(washColorFromPixels(data))).toBeGreaterThan(180);
  });
});

describe('washGradient', () => {
  it('fades from the sampled colour to nothing, as the site does', () => {
    const css = washGradient('#152433');

    expect(css).toContain('#152433 20%');
    expect(css).toContain('rgba(0, 0, 0, 0) 65%');
    expect(css.startsWith('radial-gradient(')).toBe(true);
  });
});
