import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { blendOver, contrastRatio, relativeLuminance, scaleColor } from '@/lib/color-utils';
import {
  buildDashboardThemeStyle,
  buildGlassThemeStyle,
  CATEGORY_COLORS,
  CATEGORY_TINT,
  DEFAULT_DASHBOARD_THEME,
  PALETTES,
  THEME_VAR_KEYS,
} from '@/lib/dashboard-theme';

// The fixed category colours (media types, charts, badges) on a light custom
// palette: darkened so text in them reaches 4.5:1, and icons and marks 3:1, on
// the page, sidebar and cards, also on a badge's wash of its own colour. Dark
// palettes, and the dark surfaces a light palette still has, keep the
// globals.css values.

const style = (palette: string, extra: Partial<typeof DEFAULT_DASHBOARD_THEME> = {}) =>
  buildDashboardThemeStyle({ ...DEFAULT_DASHBOARD_THEME, palette, ...extra }) as Record<string, string>;
const SURFACES = ['--hpr-ink', '--hpr-inkSoft', '--hpr-surface', '--hpr-surfaceHi'];
const KEYS = Object.keys(CATEGORY_COLORS);
const css = readFileSync(path.join(process.cwd(), 'src/app/globals.css'), 'utf8');

describe('category colours', () => {
  it('mirror the globals.css defaults', () => {
    for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
      expect(css).toContain(`${key}: ${color};`);
    }
  });

  it('blend a wash as the browser paints it', () => {
    expect(blendOver('#ffffff', '#000000', 0.2)).toBe('#cccccc');
    expect(blendOver('#ece5d6', '#00a4dc', 0.2)).toBe('#bdd8d7');
  });

  it('are swept when the theme changes', () => {
    for (const key of KEYS) expect(THEME_VAR_KEYS).toContain(key);
  });

  // #808080 and the others are mid-tone pages with dark text: data-scheme
  // calls them dark, and no colour reaches 4.5:1 there.
  it.each(['warm', 'slate', 'pure', '#101418', '#808080', '#4040ff', '#3a7bd5', '#e04040', '#8040c0'])('are left to globals.css on the dark or mid-tone %s palette', (palette) => {
    const vars = style(palette);
    for (const key of KEYS) expect(vars[key]).toBeUndefined();
  });

  it.each(['cream', '#f0f0f0', '#d0d8e0', '#fff4e0'])('reach 4.5:1 on every surface of the light %s palette', (palette) => {
    for (const accent of ['amber', 'cyan', '#3366ff']) {
      const vars = style(palette, { accent });
      for (const key of KEYS) {
        expect(vars[key]).toMatch(/^#[0-9a-f]{6}$/);
        for (const surface of SURFACES) {
          expect(contrastRatio(vars[key], vars[surface])).toBeGreaterThanOrEqual(4.5);
          // A badge: text on a 20% (and lighter) wash of its own colour.
          for (const tint of [CATEGORY_TINT, 0.15, 0.1]) {
            expect(contrastRatio(vars[key], blendOver(vars[surface], vars[key], tint))).toBeGreaterThanOrEqual(4.5);
          }
        }
      }
    }
  });

  // The theme is an inline style on <html>; these surfaces stay dark on a
  // light palette, so a stylesheet rule puts the dark values back there.
  it('keep the dark values on the Cinematic Watch skin and black poster badges of a light palette', () => {
    const rule = /html\[data-scheme='light'\]\[data-watch-skin='cinematic'\]:has\(\.hpr-watch\),\s*html\[data-scheme='light'\] \.hpr-on-dark \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    for (const [key, color] of Object.entries(CATEGORY_COLORS)) {
      expect(rule![1]).toContain(`${key}: ${color} !important;`);
      // 4.5:1 as text on the skin's #141414 ground and on black.
      expect(contrastRatio(color, '#141414')).toBeGreaterThanOrEqual(4.5);
      expect(contrastRatio(color, '#000000')).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('take the dark Glass colours on those surfaces under Liquid Glass light', () => {
    const rule = /html\[data-glass\]\[data-scheme='light'\]\[data-watch-skin='cinematic'\]:has\(\.hpr-watch\),\s*html\[data-glass\]\[data-scheme='light'\] \.hpr-on-dark \{([^}]*)\}/.exec(css);
    expect(rule).not.toBeNull();
    const glassDark = buildGlassThemeStyle('dark', 60);
    for (const key of KEYS) expect(rule![1]).toContain(`${key}: ${glassDark[key]} !important;`);
  });

  // Every light custom palette: none goes darker than 30% of itself (near
  // black), the seven stay apart, and they reach 4.5:1 on any page bright
  // enough for it, 3:1 on a dimmer one.
  it('never turn near-black on a light custom palette', () => {
    const steps = [0x00, 0x40, 0x80, 0x8e, 0xb4, 0xd0, 0xff];
    const hex = (n: number) => n.toString(16).padStart(2, '0');
    let light = 0;
    for (const r of steps) for (const g of steps) for (const b of steps) {
      const base = `#${hex(r)}${hex(g)}${hex(b)}`;
      const vars = style(base);
      if (vars['--hpr-green'] === undefined) continue;
      light += 1;
      const values = KEYS.map((key) => vars[key]);
      expect(new Set(values).size, base).toBe(KEYS.length);
      const dimmest = Math.min(...SURFACES.map((s) => relativeLuminance(vars[s])));
      for (const key of KEYS) {
        expect(relativeLuminance(vars[key]), `${base} ${key}`).toBeGreaterThanOrEqual(relativeLuminance(scaleColor(CATEGORY_COLORS[key], 0.3)));
        const ratio = Math.min(...SURFACES.map((s) => contrastRatio(vars[key], vars[s])));
        if (dimmest >= 0.4) expect(ratio, `${base} ${key}`).toBeGreaterThanOrEqual(4.5);
        else if (dimmest >= 0.3) expect(ratio, `${base} ${key}`).toBeGreaterThanOrEqual(3);
      }
    }
    expect(light).toBeGreaterThan(50);
    // The ones the review found: a dim surfaceHi, or a wash no colour clears.
    for (const base of ['#8e8e8e', '#00b4b4', '#fa5fff', '#80b480']) {
      const values = KEYS.map((key) => style(base)[key]);
      expect(new Set(values).size, base).toBe(KEYS.length);
      expect(values, base).not.toContain('#000000');
    }
  });

  it('stay darkened on Cream with a custom (light) text colour', () => {
    const vars = style('cream', { fg: '#fafafa' });
    for (const key of KEYS) expect(vars[key]).toBe(style('cream')[key]);
  });

  it('match the Cream before/after table', () => {
    const { tokens } = PALETTES.cream;
    const vars = style('cream');
    const row = (color: string) => [tokens.inkSoft, tokens.ink, tokens.surface, tokens.surfaceHi]
      .map((bg) => contrastRatio(color, bg).toFixed(2)).join(' / ')
      + ` · on its 20% wash over the page ${contrastRatio(color, blendOver(tokens.inkSoft, color, CATEGORY_TINT)).toFixed(2)}`;
    const table = Object.fromEntries(KEYS.map((key) => [key, {
      before: `${CATEGORY_COLORS[key]} ${row(CATEGORY_COLORS[key])}`,
      after: `${vars[key]} ${row(vars[key])}`,
    }]));
    expect(table).toMatchInlineSnapshot(`
      {
        "--hpr-blue": {
          "after": "#42566c 6.02 / 6.77 / 7.25 / 7.56 · on its 20% wash over the page 4.51",
          "before": "#82a8d3 1.97 / 2.22 / 2.37 / 2.47 · on its 20% wash over the page 1.74",
        },
        "--hpr-cyan": {
          "after": "#005977 6.21 / 6.98 / 7.47 / 7.79 · on its 20% wash over the page 4.57",
          "before": "#00a4dc 2.28 / 2.56 / 2.74 / 2.86 · on its 20% wash over the page 1.90",
        },
        "--hpr-green": {
          "after": "#295c44 6.18 / 6.94 / 7.44 / 7.75 · on its 20% wash over the page 4.62",
          "before": "#5ac893 1.66 / 1.86 / 1.99 / 2.08 · on its 20% wash over the page 1.49",
        },
        "--hpr-pink": {
          "after": "#774559 6.02 / 6.77 / 7.25 / 7.55 · on its 20% wash over the page 4.51",
          "before": "#d97da1 2.26 / 2.54 / 2.72 / 2.84 · on its 20% wash over the page 1.93",
        },
        "--hpr-purple": {
          "after": "#634c6d 6.01 / 6.75 / 7.23 / 7.54 · on its 20% wash over the page 4.51",
          "before": "#bb90ce 2.09 / 2.35 / 2.52 / 2.63 · on its 20% wash over the page 1.83",
        },
        "--hpr-rose": {
          "after": "#843d47 6.11 / 6.87 / 7.35 / 7.67 · on its 20% wash over the page 4.52",
          "before": "#e36a7a 2.53 / 2.85 / 3.05 / 3.18 · on its 20% wash over the page 2.11",
        },
        "--hpr-violet": {
          "after": "#554d7e 6.09 / 6.84 / 7.33 / 7.64 · on its 20% wash over the page 4.58",
          "before": "#877bc8 2.94 / 3.30 / 3.54 / 3.69 · on its 20% wash over the page 2.44",
        },
      }
    `);
  });
});
