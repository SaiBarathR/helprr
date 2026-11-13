import { describe, expect, it } from 'vitest';
import { blendOver } from '@/lib/color-utils';
import { ACCENT_COLORS, buildDashboardThemeStyle, buildGlassThemeStyle, CATEGORY_TINT, DEFAULT_DASHBOARD_THEME, PALETTES, THEME_VAR_KEYS } from '@/lib/dashboard-theme';

// The active tab's label on the non-Glass themes: tinted with the accent,
// except cyan, where only the icon takes it and the label keeps the text
// colour (as under Liquid Glass). On a light palette the accent is darkened.

function luminance(hex: string): number {
  const x = parseInt(hex.slice(1), 16);
  const f = (v: number) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f((x >> 16) & 255) + 0.7152 * f((x >> 8) & 255) + 0.0722 * f(x & 255);
}
function contrast(a: string, b: string): number {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}

const style = (accent: string, palette = 'warm') =>
  buildDashboardThemeStyle({ ...DEFAULT_DASHBOARD_THEME, accent, palette }) as Record<string, string>;

describe('the active tab label', () => {
  it('is the text colour with the cyan accent, on every palette', () => {
    for (const [name, { tokens }] of Object.entries(PALETTES)) {
      expect(style('cyan', name)['--hpr-tab-label']).toBe(tokens.fg);
      expect(style(ACCENT_COLORS.cyan.color.toUpperCase(), name)['--hpr-tab-label']).toBe(tokens.fg);
    }
  });

  it('keeps the accent tint with the other accents', () => {
    for (const accent of ['amber', 'crimson', 'violet', 'forest']) {
      expect(style(accent)['--hpr-tab-label']).toBe(ACCENT_COLORS[accent].color);
    }
    expect(style('#123456')['--hpr-tab-label']).toBe('#123456');
  });

  it('is swept with the other theme vars when Liquid Glass turns on', () => {
    expect(THEME_VAR_KEYS).toContain('--hpr-tab-label');
  });

  // The bar is the page background (inkSoft), the sidebar the ink.
  it.each(Object.entries(PALETTES))('with cyan on %s, the label reaches AA on the bar and the sidebar', (_name, { tokens }) => {
    expect(contrast(tokens.fg, tokens.inkSoft)).toBeGreaterThanOrEqual(4.5);
    expect(contrast(tokens.fg, tokens.ink)).toBeGreaterThanOrEqual(4.5);
  });

  // The icon stays cyan: 6.6-7.3:1 on the dark palettes.
  it.each(['warm', 'slate', 'pure'])('the cyan icon reaches 3:1 on the dark %s palette, unchanged', (name) => {
    const { tokens } = PALETTES[name];
    expect(style('cyan', name)['--hpr-amber']).toBe(ACCENT_COLORS.cyan.color);
    expect(contrast(ACCENT_COLORS.cyan.color, tokens.inkSoft)).toBeGreaterThanOrEqual(3);
    expect(contrast(ACCENT_COLORS.cyan.color, tokens.ink)).toBeGreaterThanOrEqual(3);
  });
});

describe('the accent on a light palette', () => {
  // The accents are made for dark pages. On Cream they were 1.4:1 (Amber) to
  // 3.0:1 (Violet) on the bar; Cyan alone was darkened, to 4.6:1. Every accent
  // is now darkened (same hue) until it reads as text, 4.5:1, on the bar, the
  // sidebar and the cards, also on a 20% wash of itself (an active filter chip).
  const SURFACES = ['--hpr-ink', '--hpr-inkSoft', '--hpr-surface', '--hpr-surfaceHi'];
  const hue = (hex: string) => {
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    return Math.atan2(Math.sqrt(3) * (g - b), 2 * r - g - b);
  };

  // #d0d8e0 is dim enough that the wash rung would take the accents within
  // 1.5:1 of the text colour (the floor), so there they read 4.5:1 without it.
  it.each([['cream', true], ['#f0f0f0', true], ['#fff4e0', true], ['#d0d8e0', false]])('reads as text with every accent on the light %s palette', (palette, onWash) => {
    for (const accent of [...Object.keys(ACCENT_COLORS), '#3366ff', '#ffd400']) {
      const vars = style(accent, palette);
      const color = vars['--hpr-amber'];
      for (const key of SURFACES) {
        expect(contrast(color, vars[key])).toBeGreaterThanOrEqual(4.5);
        if (onWash) expect(contrast(color, blendOver(vars[key], color, CATEGORY_TINT))).toBeGreaterThanOrEqual(4.5);
      }
      // The dark surfaces (player, scrims) get the accent as picked.
      expect(vars['--hpr-accent-on-dark']).toBe(accent in ACCENT_COLORS ? ACCENT_COLORS[accent].color : accent);
      // A primary button's label (the page colour on the accent) reads too.
      expect(contrast(vars['--hpr-ink'], color)).toBeGreaterThanOrEqual(4.5);
      // Darkened, not recoloured: the hue stays within a couple of degrees.
      const source = accent in ACCENT_COLORS ? ACCENT_COLORS[accent].color : accent;
      expect(Math.abs(hue(color) - hue(source))).toBeLessThan(0.05);
      // The label: the text colour with cyan, the darkened accent otherwise.
      expect(vars['--hpr-tab-label']).toBe(accent === 'cyan' ? vars['--hpr-fg'] : color);
    }
  });

  it('darkens the Cream accents to these values', () => {
    expect(Object.fromEntries(Object.keys(ACCENT_COLORS).map((a) => [a, style(a, 'cream')['--hpr-amber']]))).toEqual({
      amber: '#69501f',
      crimson: '#843d47',
      cyan: '#005977',
      violet: '#58449e',
      forest: '#295c44',
    });
  });

  it('stays darkened on Cream with a custom text colour', () => {
    const vars = buildDashboardThemeStyle({ ...DEFAULT_DASHBOARD_THEME, accent: 'cyan', palette: 'cream', fg: '#fafafa' }) as Record<string, string>;
    expect(vars['--hpr-amber']).toBe('#005977');
  });

  it('leaves an accent that already reads on a light palette alone', () => {
    expect(style('#1a3d8f', 'cream')['--hpr-amber']).toBe('#1a3d8f');
  });

  // #808080: a mid-tone page with dark text, which data-scheme (and so the
  // category colours and the dark-surface reset) calls dark.
  it.each(['warm', 'slate', 'pure', '#101418', '#808080'])('leaves every accent alone on the dark %s palette', (palette) => {
    for (const [accent, { color }] of Object.entries(ACCENT_COLORS)) {
      expect(style(accent, palette)['--hpr-amber']).toBe(color);
      expect(style(accent, palette)['--hpr-accent-on-dark']).toBe(color);
    }
    expect(style('#3366ff', palette)['--hpr-amber']).toBe('#3366ff');
  });

  // A grey page is too dim for 4.5:1 without the accents nearing the body text
  // (#b0b0b0 took all five to near-black, 1.16:1 from the text; #9a9a9a to
  // #000000). They stop 1.5:1 from the text colour instead, still five hues.
  it.each([['#9a9a9a', 2.7], ['#b0b0b0', 3], ['#c0c0c0', 3]])('stops the accents short of the body text on the grey %s palette', (palette, onSurfaces) => {
    const colors = Object.keys(ACCENT_COLORS).map((accent) => {
      const vars = style(accent, palette);
      const color = vars['--hpr-amber'];
      expect(color).not.toBe('#000000');
      expect(contrast(color, vars['--hpr-fg'])).toBeGreaterThanOrEqual(1.5);
      for (const key of SURFACES) expect(contrast(color, vars[key])).toBeGreaterThanOrEqual(onSurfaces);
      expect(Math.abs(hue(color) - hue(ACCENT_COLORS[accent].color))).toBeLessThan(0.05);
      return color;
    });
    expect(new Set(colors).size).toBe(colors.length);
  });

  it('keeps an accent the user picked darker than the floor as it is', () => {
    expect(style('#2a2a40', '#b0b0b0')['--hpr-amber']).toBe('#2a2a40');
  });

  it('is swept with the other theme vars and left out of Liquid Glass', () => {
    expect(THEME_VAR_KEYS).toContain('--hpr-accent-on-dark');
    expect(buildGlassThemeStyle('light', 60)).not.toHaveProperty('--hpr-accent-on-dark');
  });
});
