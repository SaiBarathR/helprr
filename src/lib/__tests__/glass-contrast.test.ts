import { describe, expect, it } from 'vitest';
import {
  buildGlassThemeStyle,
  DEFAULT_GLASS_INTENSITY,
  type GlassScheme,
} from '@/lib/dashboard-theme';

// WCAG 2.x contrast for the Liquid Glass tokens, measured where they are
// actually painted: text over the page, surfaces and card fill, and over the
// translucent chrome/sheet materials with the worst backdrop behind them
// (a black poster under light glass, a white one under dark glass) or a
// typical mid-grey one.

type Rgba = [number, number, number, number];

function parse(color: string): Rgba {
  const hex = /^#([0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const x = parseInt(hex[1], 16);
    return [(x >> 16) & 255, (x >> 8) & 255, x & 255, 1];
  }
  const rgba = /^rgba\((\d+),(\d+),(\d+),([\d.]+)\)$/.exec(color.replace(/\s/g, ''));
  if (!rgba) throw new Error(`unparsed colour ${color}`);
  return [Number(rgba[1]), Number(rgba[2]), Number(rgba[3]), Number(rgba[4])];
}

function over(color: string, backdrop: Rgba): Rgba {
  const [r, g, b, a] = parse(color);
  return [r * a + backdrop[0] * (1 - a), g * a + backdrop[1] * (1 - a), b * a + backdrop[2] * (1 - a), 1];
}

function luminance([r, g, b]: Rgba): number {
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function contrast(text: string, background: Rgba): number {
  const a = luminance(over(text, background));
  const b = luminance(background);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

const AA = 4.5;
const WORST_BACKDROP: Record<GlassScheme, Rgba> = {
  light: [0, 0, 0, 1],
  dark: [255, 255, 255, 1],
};
const TYPICAL_BACKDROP: Rgba = [128, 128, 128, 1];

describe.each<GlassScheme>(['light', 'dark'])('Liquid Glass %s contrast at the default intensity', (scheme) => {
  const vars = buildGlassThemeStyle(scheme, DEFAULT_GLASS_INTENSITY);
  const ink = parse(vars['--hpr-ink']);
  const textTokens = ['--hpr-fg', '--hpr-fgMute', '--hpr-fgSubtle'];

  const pageBackgrounds: Record<string, Rgba> = {
    ink,
    surface: parse(vars['--hpr-surface']),
    // Reduced-transparency fallback paints bento cells in surfaceHi.
    surfaceHi: parse(vars['--hpr-surfaceHi']),
    'card fill': over(vars['--hpr-glass-fill'], ink),
  };

  it.each(textTokens)('%s reaches AA on every page background', (token) => {
    for (const [name, bg] of Object.entries(pageBackgrounds)) {
      expect(contrast(vars[token], bg), `${token} on ${name}`).toBeGreaterThanOrEqual(AA);
    }
  });

  // The bars let some content show through (owner, 2026-11-07), so only the
  // text and grey labels they carry are held to AA over the worst backdrop.
  it('bars are 85-90% opaque', () => {
    expect(parse(vars['--hpr-glass-bg'])[3]).toBeGreaterThanOrEqual(0.85);
    expect(parse(vars['--hpr-glass-bg'])[3]).toBeLessThanOrEqual(0.9);
  });

  it('text and grey labels reach AA on the bars over the worst backdrop', () => {
    const bg = over(vars['--hpr-glass-bg'], WORST_BACKDROP[scheme]);
    for (const token of ['--hpr-fg', '--hpr-fgMute']) {
      expect(contrast(vars[token], bg), token).toBeGreaterThanOrEqual(AA);
    }
  });

  it('every text token reaches AA on the bars over typical content', () => {
    const bg = over(vars['--hpr-glass-bg'], TYPICAL_BACKDROP);
    for (const token of textTokens) {
      expect(contrast(vars[token], bg), token).toBeGreaterThanOrEqual(AA);
    }
  });

  // The active tab's icon is the tint; its 11px label is --hpr-fg, held to AA
  // above. On the 0.88 bars the tint is 3.99 (light) / 3.25 (dark) over the
  // worst backdrop and 4.62 / 4.04 over typical content, under AA as a label,
  // so only the icon's 3:1 (WCAG 1.4.11) is held here.
  it('the active-tab tint reaches 3:1 on the bars over the worst backdrop', () => {
    const bg = over(vars['--hpr-glass-bg'], WORST_BACKDROP[scheme]);
    expect(contrast(vars['--hpr-amber'], bg)).toBeGreaterThanOrEqual(3);
  });

  it('text tokens reach AA on --hpr-glass-bg-strong over the worst backdrop', () => {
    const bg = over(vars['--hpr-glass-bg-strong'], WORST_BACKDROP[scheme]);
    for (const token of textTokens) {
      expect(contrast(vars[token], bg), token).toBeGreaterThanOrEqual(AA);
    }
  });
});

describe('Liquid Glass light accent colours as text', () => {
  const vars = buildGlassThemeStyle('light', DEFAULT_GLASS_INTENSITY);
  const ink = parse(vars['--hpr-ink']);
  const backgrounds: Record<string, Rgba> = {
    ink,
    surface: parse(vars['--hpr-surface']),
    'card fill': over(vars['--hpr-glass-fill'], ink),
    sheet: over(vars['--hpr-glass-bg-strong'], WORST_BACKDROP.light),
  };

  it.each([
    '--hpr-amber',
    '--hpr-green',
    '--hpr-rose',
    '--hpr-blue',
    '--hpr-purple',
    '--hpr-violet',
    '--hpr-cyan',
    '--hpr-pink',
  ])('%s reaches AA on the page, cards and sheets', (token) => {
    for (const [name, bg] of Object.entries(backgrounds)) {
      expect(contrast(vars[token], bg), `${token} on ${name}`).toBeGreaterThanOrEqual(AA);
    }
  });

  // --destructive is the rose in glass, so destructive buttons carry white
  // text on it.
  it('white text reaches AA on the rose fill', () => {
    expect(contrast('#FFFFFF', parse(vars['--hpr-rose']))).toBeGreaterThanOrEqual(AA);
  });
});
