/**
 * Dashboard "Bento" theme presets + live applier.
 *
 * Values mirror the design source at
 *   /tmp/design-fetch/helprrdashbaord/project/tweaks-panel.jsx
 * so the dashboard is reskinnable without leaking changes to the rest of the
 * app (which keeps the existing OKLch tokens in globals.css).
 */

import type * as React from 'react';
import { generatePaletteFromBase, type PaletteTokens } from './color-utils';

export type DashboardAccent = string;
export type DashboardPalette = string;
export type DashboardGradient = 'glow' | 'frame' | 'none';
export type DashboardFont = 'system' | 'helvetica' | 'charter' | 'jetbrains';

export interface DashboardThemePrefs {
  accent: DashboardAccent;
  palette: DashboardPalette;
  gradient: DashboardGradient;
  font: DashboardFont;
  fg?: string;
  fgMute?: string;
  fgSubtle?: string;
}

export const DEFAULT_DASHBOARD_THEME: DashboardThemePrefs = {
  accent: 'amber',
  palette: 'warm',
  gradient: 'glow',
  font: 'system',
};

export const ACCENT_COLORS: Record<DashboardAccent, { color: string; label: string }> = {
  amber: { color: '#f5b948', label: 'Amber' },
  crimson: { color: '#e36a7a', label: 'Crimson' },
  cyan: { color: '#00a4dc', label: 'Cyan' },
  violet: { color: '#8a6bf7', label: 'Violet' },
  forest: { color: '#5ac893', label: 'Forest' },
};

export const PALETTES: Record<DashboardPalette, { label: string; tokens: PaletteTokens; swatch: [string, string, string] }> = {
  warm: {
    label: 'Warm Ink',
    swatch: ['#15110c', '#1c1813', '#f5b948'],
    tokens: {
      ink: '#100c08',
      inkSoft: '#15110c',
      surface: '#1c1813',
      surfaceHi: '#231e17',
      hairline: 'rgba(255,214,160,0.09)',
      hairline2: 'rgba(255,214,160,0.16)',
      fg: '#f4ead7',
      fgMute: '#b9a98c',
      fgSubtle: '#7a6c54',
    },
  },
  slate: {
    label: 'Cool Slate',
    swatch: ['#0e1218', '#161b22', '#7fb6ff'],
    tokens: {
      ink: '#0a0d12',
      inkSoft: '#0e1218',
      surface: '#161b22',
      surfaceHi: '#1c222b',
      hairline: 'rgba(180,210,255,0.08)',
      hairline2: 'rgba(180,210,255,0.15)',
      fg: '#e6edf3',
      fgMute: '#9aa7b6',
      fgSubtle: '#6a7685',
    },
  },
  pure: {
    label: 'Pure Black',
    swatch: ['#000000', '#0a0a0a', '#ffffff'],
    tokens: {
      ink: '#000000',
      inkSoft: '#070707',
      surface: '#101010',
      surfaceHi: '#171717',
      hairline: 'rgba(255,255,255,0.07)',
      hairline2: 'rgba(255,255,255,0.13)',
      fg: '#f5f5f5',
      fgMute: '#a0a0a0',
      fgSubtle: '#666666',
    },
  },
  cream: {
    label: 'Cream',
    swatch: ['#f6f2ea', '#ece5d6', '#7a5b2a'],
    tokens: {
      ink: '#f6f2ea',
      inkSoft: '#ece5d6',
      surface: '#fdfaf3',
      surfaceHi: '#ffffff',
      hairline: 'rgba(60,40,15,0.10)',
      hairline2: 'rgba(60,40,15,0.20)',
      fg: '#2a2218',
      fgMute: '#6e604a',
      fgSubtle: '#9a8c73',
    },
  },
};

export const GRADIENTS: Record<DashboardGradient, { label: string; value: string }> = {
  glow: {
    label: 'Glow',
    value:
      'radial-gradient(ellipse 80% 50% at 50% -10%, color-mix(in oklab, var(--hpr-amber) 8%, transparent), transparent 60%)',
  },
  frame: {
    label: 'Frame',
    value:
      'linear-gradient(180deg, color-mix(in oklab, var(--hpr-amber) 8%, transparent), transparent 18%, transparent 82%, color-mix(in oklab, var(--hpr-amber) 4%, transparent))',
  },
  none: {
    label: 'None',
    value: 'none',
  },
};

export const FONTS: Record<
  DashboardFont,
  { label: string; sub: string; body: string; display: string; mono: string }
> = {
  system: {
    label: 'System',
    sub: '-apple-system',
    body:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
    display:
      '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Segoe UI", system-ui, sans-serif',
    mono: '"SF Mono", ui-monospace, "JetBrains Mono", Menlo, monospace',
  },
  helvetica: {
    label: 'Helvetica',
    sub: 'Neue / Now',
    body: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    display: '"Helvetica Neue", Helvetica, Arial, sans-serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  charter: {
    label: 'Charter',
    sub: 'Serif accent',
    body:
      '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Helvetica Neue", system-ui, sans-serif',
    display: 'Charter, "Iowan Old Style", "Apple Garamond", Georgia, ui-serif, serif',
    mono: 'ui-monospace, "SF Mono", Menlo, monospace',
  },
  jetbrains: {
    label: 'Mono',
    sub: 'JetBrains',
    body: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
    display: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
    mono: '"JetBrains Mono", ui-monospace, "SF Mono", Menlo, monospace',
  },
};

export type GlassMode = 'light' | 'dark' | 'system';
export type GlassScheme = 'light' | 'dark';

export const DEFAULT_GLASS_MODE: GlassMode = 'system';
export const DEFAULT_GLASS_INTENSITY = 60;
/** Liquid Glass (following the system light/dark scheme) is the app default
 *  for new users; existing users keep whatever theme they already had. */
export const DEFAULT_LIQUID_GLASS = true;

/**
 * Apple system palettes for Liquid Glass mode (iOS systemBackground /
 * label / separator conventions). The accent slot stays `--hpr-amber`
 * because --primary/--ring alias it in globals.css.
 */
export const GLASS_PALETTES: Record<GlassScheme, PaletteTokens> = {
  light: {
    ink: '#F2F2F7',
    inkSoft: '#F2F2F7',
    surface: '#FFFFFF',
    surfaceHi: '#E5E5EA',
    hairline: 'rgba(60,60,67,0.12)',
    hairline2: 'rgba(60,60,67,0.29)',
    fg: '#000000',
    fgMute: 'rgba(60,60,67,0.60)',
    fgSubtle: 'rgba(60,60,67,0.30)',
  },
  dark: {
    ink: '#000000',
    inkSoft: '#000000',
    surface: '#1C1C1E',
    surfaceHi: '#2C2C2E',
    hairline: 'rgba(84,84,88,0.35)',
    hairline2: 'rgba(84,84,88,0.60)',
    fg: '#FFFFFF',
    fgMute: 'rgba(235,235,245,0.60)',
    fgSubtle: 'rgba(235,235,245,0.30)',
  },
};

export const GLASS_TINT: Record<GlassScheme, string> = {
  light: '#007AFF',
  dark: '#0A84FF',
};

/** iOS system colors for the chart/status vars that are otherwise static in globals.css. */
const GLASS_CHART_COLORS: Record<GlassScheme, Record<string, string>> = {
  light: {
    '--hpr-green': '#34C759',
    '--hpr-rose': '#FF3B30',
    '--hpr-blue': '#007AFF',
    '--hpr-purple': '#AF52DE',
    '--hpr-violet': '#5856D6',
    '--hpr-cyan': '#32ADE6',
    '--hpr-pink': '#FF2D55',
  },
  dark: {
    '--hpr-green': '#30D158',
    '--hpr-rose': '#FF453A',
    '--hpr-blue': '#0A84FF',
    '--hpr-purple': '#BF5AF2',
    '--hpr-violet': '#5E5CE6',
    '--hpr-cyan': '#64D2FF',
    '--hpr-pink': '#FF375F',
  },
};

/** Page background color per scheme, for the <meta name="theme-color"> tag. */
export function glassThemeColor(scheme: GlassScheme): string {
  return scheme === 'dark' ? '#000000' : '#F2F2F7';
}

const round3 = (n: number) => Math.round(n * 1000) / 1000;

/**
 * Glass material vars from intensity 0-100. Anchored on Apple's UIBlurEffect
 * regular material (~blur 30px + saturate 180%): 0 = fully transparent,
 * 100 = fully frosted. Values stay in vars so CSS fallbacks
 * (prefers-reduced-transparency / no backdrop-filter support) can ignore them.
 */
function glassMaterialVars(scheme: GlassScheme, intensity: number): Record<string, string> {
  const t = Math.min(100, Math.max(0, intensity)) / 100;
  const light = scheme === 'light';
  const bgBase = light ? '242,242,247' : '28,28,30';
  const fillBase = light ? '255,255,255' : '28,28,30';

  return {
    '--hpr-glass-blur': `${Math.round(36 * t)}px`,
    '--hpr-glass-saturate': String(round3(1 + 0.8 * t)),
    '--hpr-glass-bg': `rgba(${bgBase},${round3(0.85 * t)})`,
    '--hpr-glass-bg-strong': `rgba(${bgBase},${round3(Math.max(0.55, 0.85 * t))})`,
    '--hpr-glass-fill': `rgba(${fillBase},${round3(0.45 + 0.5 * t)})`,
    '--hpr-glass-border': light
      ? `rgba(60,60,67,${round3(0.1 + 0.12 * t)})`
      : `rgba(255,255,255,${round3(0.06 + 0.1 * t)})`,
    '--hpr-glass-highlight': light
      ? `rgba(255,255,255,${round3(0.45 + 0.3 * t)})`
      : `rgba(255,255,255,${round3(0.04 + 0.08 * t)})`,
    '--hpr-glass-wallpaper': light
      ? 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(0,122,255,0.07), transparent 60%)'
      : 'radial-gradient(ellipse 90% 60% at 50% -10%, rgba(10,132,255,0.10), transparent 60%)',
  };
}

/**
 * Flat --hpr-* var map for Liquid Glass mode. Ignores all custom theme prefs
 * (accent/palette/gradient/text/font) by design — Apple system palette, blue
 * tint, system font stack, no page gradient.
 */
export function buildGlassThemeStyle(scheme: GlassScheme, intensity: number): Record<string, string> {
  const palette = GLASS_PALETTES[scheme];
  const font = FONTS.system;

  return {
    '--hpr-ink': palette.ink,
    '--hpr-inkSoft': palette.inkSoft,
    '--hpr-surface': palette.surface,
    '--hpr-surfaceHi': palette.surfaceHi,
    '--hpr-hairline': palette.hairline,
    '--hpr-hairline2': palette.hairline2,
    '--hpr-fg': palette.fg,
    '--hpr-fgMute': palette.fgMute,
    '--hpr-fgSubtle': palette.fgSubtle,
    '--hpr-amber': GLASS_TINT[scheme],
    '--hpr-font-body': font.body,
    '--hpr-font-display': font.display,
    '--hpr-font-mono': font.mono,
    '--hpr-bg-grad': 'none',
    ...GLASS_CHART_COLORS[scheme],
    ...glassMaterialVars(scheme, intensity),
  };
}

/**
 * Every var either builder can emit. ThemeApplier sweeps keys absent from the
 * active style so toggling glass off restores the globals.css defaults
 * (chart colors) and drops the glass material vars without a reload.
 */
export const THEME_VAR_KEYS: readonly string[] = Array.from(
  new Set([
    ...Object.keys(buildDashboardThemeStyle(DEFAULT_DASHBOARD_THEME)),
    ...Object.keys(buildGlassThemeStyle('dark', DEFAULT_GLASS_INTENSITY)),
  ]),
);

/** Resolve theme prefs into concrete token values (palette + per-tone overrides). */
function resolveThemeTokens(prefs: DashboardThemePrefs) {
  const accent = prefs.accent in ACCENT_COLORS
    ? ACCENT_COLORS[prefs.accent].color
    : prefs.accent;

  const basePalette = prefs.palette in PALETTES
    ? PALETTES[prefs.palette].tokens
    : generatePaletteFromBase(prefs.palette, accent);

  const palette: PaletteTokens = {
    ...basePalette,
    fg: prefs.fg ?? basePalette.fg,
    fgMute: prefs.fgMute ?? basePalette.fgMute,
    fgSubtle: prefs.fgSubtle ?? basePalette.fgSubtle,
  };

  const font = prefs.font in FONTS ? FONTS[prefs.font] : FONTS.system;
  const gradient = prefs.gradient in GRADIENTS ? GRADIENTS[prefs.gradient].value : GRADIENTS.none.value;

  return { accent, palette, font, gradient };
}

/** Build a React style object containing every --hpr-* variable. */
export function buildDashboardThemeStyle(prefs: DashboardThemePrefs): React.CSSProperties {
  const { accent, palette, font, gradient } = resolveThemeTokens(prefs);

  return {
    ['--hpr-ink' as string]: palette.ink,
    ['--hpr-inkSoft' as string]: palette.inkSoft,
    ['--hpr-surface' as string]: palette.surface,
    ['--hpr-surfaceHi' as string]: palette.surfaceHi,
    ['--hpr-hairline' as string]: palette.hairline,
    ['--hpr-hairline2' as string]: palette.hairline2,
    ['--hpr-fg' as string]: palette.fg,
    ['--hpr-fgMute' as string]: palette.fgMute,
    ['--hpr-fgSubtle' as string]: palette.fgSubtle,
    ['--hpr-amber' as string]: accent,
    ['--hpr-font-body' as string]: font.body,
    ['--hpr-font-display' as string]: font.display,
    ['--hpr-font-mono' as string]: font.mono,
    ['--hpr-bg-grad' as string]: gradient,
  } as React.CSSProperties;
}

/**
 * No-flash theme bootstrap.
 *
 * The theme lives in localStorage (zustand/persist), which the server can't
 * read — so SSR + first paint would otherwise use the globals.css defaults and
 * snap to the user's theme only once the store rehydrates. To avoid that,
 * ThemeApplier persists the *already-resolved* flat `--hpr-*` map under
 * THEME_VARS_STORAGE_KEY, and THEME_BOOTSTRAP_SCRIPT (a blocking inline script
 * in the root layout) replays it onto <html> before React hydrates. Persisting
 * the resolved values keeps a single source of truth (buildDashboardThemeStyle)
 * — the script needs no palette math and can't drift from the React path.
 */
export const THEME_VARS_STORAGE_KEY = 'helprr-theme-vars';

/**
 * Persisted payload shapes. Glass off: the legacy flat var map. Glass on: a
 * dual-map payload (resolved vars for BOTH schemes) discriminated by the
 * reserved `__glass` key, so the bootstrap script can follow `system` mode via
 * matchMedia at boot with no palette math and no flash.
 */
export type PersistedThemeVars =
  | Record<string, string>
  | {
      __glass: { scheme: GlassMode; tcLight: string; tcDark: string };
      __light: Record<string, string>;
      __dark: Record<string, string>;
    };

/**
 * Self-contained vanilla-JS string for a blocking <script> in the document head/
 * top-of-body. Replays ONLY the persisted `--hpr-*` theme vars onto <html>
 * pre-paint; does nothing (defaults stand) when no vars are stored yet, the
 * stored value isn't an object, or parsing fails. The `--hpr-` filter keeps a
 * corrupted/legacy localStorage payload from setting unrelated style properties
 * on the document root.
 *
 * v2: when the payload carries `__glass`, resolve the scheme (matchMedia for
 * `system`), replay that scheme's var map, set data-glass/data-glass-scheme on
 * <html>, and sync the theme-color meta. Legacy flat payloads (and payloads
 * written by this script's v1) take the plain-replay path unchanged.
 *
 * v3: first visits (no stored payload) boot straight into the app default —
 * Liquid Glass following the system scheme — via a default payload embedded
 * at build time, so new users never see the pre-glass fallback paint.
 */
const DEFAULT_BOOT_PAYLOAD = JSON.stringify({
  __glass: {
    scheme: DEFAULT_GLASS_MODE,
    tcLight: glassThemeColor('light'),
    tcDark: glassThemeColor('dark'),
  },
  __light: buildGlassThemeStyle('light', DEFAULT_GLASS_INTENSITY),
  __dark: buildGlassThemeStyle('dark', DEFAULT_GLASS_INTENSITY),
});

export const THEME_BOOTSTRAP_SCRIPT = `(function(){try{var r=localStorage.getItem(${JSON.stringify(
  THEME_VARS_STORAGE_KEY,
)});var v=r?JSON.parse(r):${DEFAULT_BOOT_PAYLOAD};if(!v||typeof v!=='object')return;var e=document.documentElement,g=v.__glass,m=v;if(g&&typeof g==='object'){var s=g.scheme==='light'?'light':g.scheme==='dark'?'dark':(matchMedia('(prefers-color-scheme: dark)').matches?'dark':'light');m=v[s==='dark'?'__dark':'__light'];if(!m||typeof m!=='object')return;e.setAttribute('data-glass','');e.setAttribute('data-glass-scheme',s);var t=document.querySelector('meta[name="theme-color"]');var c=s==='dark'?g.tcDark:g.tcLight;if(t&&typeof c==='string')t.setAttribute('content',c);}for(var k in m){if(k.indexOf('--hpr-')===0&&m[k]!=null)e.style.setProperty(k,String(m[k]));}}catch(e){}})();`;

/** Write a full set of --hpr-* variables onto `el`. */
export function applyDashboardTheme(el: HTMLElement | null, prefs: DashboardThemePrefs): void {
  if (!el) return;
  const { accent, palette, font, gradient } = resolveThemeTokens(prefs);

  el.style.setProperty('--hpr-ink', palette.ink);
  el.style.setProperty('--hpr-inkSoft', palette.inkSoft);
  el.style.setProperty('--hpr-surface', palette.surface);
  el.style.setProperty('--hpr-surfaceHi', palette.surfaceHi);
  el.style.setProperty('--hpr-hairline', palette.hairline);
  el.style.setProperty('--hpr-hairline2', palette.hairline2);
  el.style.setProperty('--hpr-fg', palette.fg);
  el.style.setProperty('--hpr-fgMute', palette.fgMute);
  el.style.setProperty('--hpr-fgSubtle', palette.fgSubtle);
  el.style.setProperty('--hpr-amber', accent);
  el.style.setProperty('--hpr-font-body', font.body);
  el.style.setProperty('--hpr-font-display', font.display);
  el.style.setProperty('--hpr-font-mono', font.mono);
  el.style.setProperty('--hpr-bg-grad', gradient);
}

/** Resolve just the foreground tokens (for showing palette defaults in pickers). */
export function resolveForegroundTones(prefs: DashboardThemePrefs): { fg: string; fgMute: string; fgSubtle: string } {
  const { palette } = resolveThemeTokens({ ...prefs, fg: undefined, fgMute: undefined, fgSubtle: undefined });
  return { fg: palette.fg, fgMute: palette.fgMute, fgSubtle: palette.fgSubtle };
}

/** Width (in columns) of each named size on the current grid. */
export function sizePresetToColSpan(
  preset: 'S' | 'M' | 'L' | 'XL',
  totalCols: number,
): number {
  if (totalCols === 2) {
    return preset === 'S' || preset === 'M' ? 1 : 2;
  }
  const map: Record<'S' | 'M' | 'L' | 'XL', number> = { S: 3, M: 4, L: 6, XL: 12 };
  return Math.min(map[preset], totalCols);
}

export const SIZE_PRESETS: Array<'S' | 'M' | 'L' | 'XL'> = ['S', 'M', 'L', 'XL'];
