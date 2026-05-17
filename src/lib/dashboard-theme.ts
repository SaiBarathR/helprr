/**
 * Dashboard "Bento" theme presets + live applier.
 *
 * Values mirror the design source at
 *   /tmp/design-fetch/helprrdashbaord/project/tweaks-panel.jsx
 * so the dashboard is reskinnable without leaking changes to the rest of the
 * app (which keeps the existing OKLch tokens in globals.css).
 */

import type * as React from 'react';

export type DashboardAccent = 'amber' | 'crimson' | 'cyan' | 'violet' | 'forest';
export type DashboardPalette = 'warm' | 'slate' | 'pure' | 'cream';
export type DashboardGradient = 'glow' | 'frame' | 'none';
export type DashboardFont = 'system' | 'helvetica' | 'charter' | 'jetbrains';

export interface DashboardThemePrefs {
  accent: DashboardAccent;
  palette: DashboardPalette;
  gradient: DashboardGradient;
  font: DashboardFont;
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

interface PaletteTokens {
  ink: string;
  inkSoft: string;
  surface: string;
  surfaceHi: string;
  hairline: string;
  hairline2: string;
  fg: string;
  fgMute: string;
  fgSubtle: string;
}

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

/** Build a React style object containing every --hpr-* variable. */
export function buildDashboardThemeStyle(prefs: DashboardThemePrefs): React.CSSProperties {
  const palette = PALETTES[prefs.palette].tokens;
  const accent = ACCENT_COLORS[prefs.accent].color;
  const font = FONTS[prefs.font];
  const gradient = GRADIENTS[prefs.gradient].value;
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

/** Write a full set of --hpr-* variables onto `el`. */
export function applyDashboardTheme(el: HTMLElement | null, prefs: DashboardThemePrefs): void {
  if (!el) return;
  const palette = PALETTES[prefs.palette].tokens;
  const accent = ACCENT_COLORS[prefs.accent].color;
  const font = FONTS[prefs.font];
  const gradient = GRADIENTS[prefs.gradient].value;

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
