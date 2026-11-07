import { describe, expect, it } from 'vitest';
import { ACCENT_COLORS, buildDashboardThemeStyle, DEFAULT_DASHBOARD_THEME, PALETTES, THEME_VAR_KEYS } from '@/lib/dashboard-theme';

// The active tab's label on the non-Glass themes: tinted with the accent,
// except cyan, where only the icon takes it and the label keeps the text
// colour (as under Liquid Glass).

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

describe('the cyan accent on a light palette', () => {
  // Cream was 2.3:1 (bar) / 2.6:1 (sidebar). Darkened, it reads as text,
  // 4.5:1, on the bar, the sidebar and the cards, so the icon passes 3:1.
  it('is darkened on Cream to #006e93: 4.59 on the bar, 5.15 on the sidebar, 5.52 on cards', () => {
    const { tokens } = PALETTES.cream;
    const cyan = style('cyan', 'cream')['--hpr-amber'];
    expect(cyan).toBe('#006e93');
    for (const bg of [tokens.inkSoft, tokens.ink, tokens.surface, tokens.surfaceHi]) {
      expect(contrast(cyan, bg)).toBeGreaterThanOrEqual(4.5);
    }
    expect(contrast(cyan, tokens.inkSoft).toFixed(2)).toBe('4.59');
    expect(contrast(cyan, tokens.ink).toFixed(2)).toBe('5.15');
    // A primary button's label (the page colour on cyan) reads too.
    expect(contrast(tokens.ink, cyan)).toBeGreaterThanOrEqual(4.5);
    // The label still keeps the text colour.
    expect(style('cyan', 'cream')['--hpr-tab-label']).toBe(tokens.fg);
  });

  it.each(['#f0f0f0', '#d0d8e0', '#fff4e0'])('is darkened on a custom light palette built from %s', (base) => {
    const vars = style('cyan', base);
    for (const key of ['--hpr-ink', '--hpr-inkSoft', '--hpr-surface', '--hpr-surfaceHi']) {
      expect(contrast(vars['--hpr-amber'], vars[key])).toBeGreaterThanOrEqual(4.5);
    }
    expect(vars['--hpr-tab-label']).toBe(vars['--hpr-fg']);
  });

  it('stays darkened on Cream with a custom text colour', () => {
    const vars = buildDashboardThemeStyle({ ...DEFAULT_DASHBOARD_THEME, accent: 'cyan', palette: 'cream', fg: '#fafafa' }) as Record<string, string>;
    expect(vars['--hpr-amber']).toBe('#006e93');
  });

  it('leaves a custom dark palette, and the other accents on Cream, alone', () => {
    expect(style('cyan', '#101418')['--hpr-amber']).toBe(ACCENT_COLORS.cyan.color);
    expect(style('amber', 'cream')['--hpr-amber']).toBe(ACCENT_COLORS.amber.color);
    expect(style('#3366ff', 'cream')['--hpr-amber']).toBe('#3366ff');
  });
});
