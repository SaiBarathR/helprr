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

  // The icon stays cyan: 6.6-7.3:1 on the dark palettes. On Cream it is
  // 2.3 (bar) / 2.6 (sidebar), under the 3:1 for icons, as it was before.
  it.each(['warm', 'slate', 'pure'])('the cyan icon reaches 3:1 on the dark %s palette', (name) => {
    const { tokens } = PALETTES[name];
    expect(contrast(ACCENT_COLORS.cyan.color, tokens.inkSoft)).toBeGreaterThanOrEqual(3);
    expect(contrast(ACCENT_COLORS.cyan.color, tokens.ink)).toBeGreaterThanOrEqual(3);
  });
});
