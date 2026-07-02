'use client';

import { useEffect, useSyncExternalStore } from 'react';
import { useUIStore } from '@/lib/store';
import {
  buildDashboardThemeStyle,
  buildGlassThemeStyle,
  glassThemeColor,
  THEME_VAR_KEYS,
  THEME_VARS_STORAGE_KEY,
  type GlassScheme,
  type PersistedThemeVars,
} from '@/lib/dashboard-theme';

function subscribeSystemScheme(callback: () => void) {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', callback);
  return () => mq.removeEventListener('change', callback);
}

function useSystemPrefersDark(): boolean {
  return useSyncExternalStore(
    subscribeSystemScheme,
    () => window.matchMedia('(prefers-color-scheme: dark)').matches,
    () => true,
  );
}

export function ThemeApplier() {
  const accent = useUIStore((s) => s.dashboardAccent);
  const palette = useUIStore((s) => s.dashboardPalette);
  const gradient = useUIStore((s) => s.dashboardGradient);
  const font = useUIStore((s) => s.dashboardFont);
  const fg = useUIStore((s) => s.dashboardFg);
  const fgMute = useUIStore((s) => s.dashboardFgMute);
  const fgSubtle = useUIStore((s) => s.dashboardFgSubtle);
  const liquidGlass = useUIStore((s) => s.liquidGlass);
  const glassMode = useUIStore((s) => s.glassMode);
  const glassIntensity = useUIStore((s) => s.glassIntensity);
  const hasHydrated = useUIStore((s) => s.hasHydrated);

  const systemPrefersDark = useSystemPrefersDark();
  const resolvedScheme: GlassScheme =
    glassMode === 'system' ? (systemPrefersDark ? 'dark' : 'light') : glassMode;

  useEffect(() => {
    if (!hasHydrated) return;

    const customStyle = buildDashboardThemeStyle({
      accent,
      palette,
      gradient,
      font,
      fg,
      fgMute,
      fgSubtle,
    }) as Record<string, string | undefined>;
    const activeStyle: Record<string, string | undefined> = liquidGlass
      ? buildGlassThemeStyle(resolvedScheme, glassIntensity)
      : customStyle;
    const root = document.documentElement;

    Object.entries(activeStyle).forEach(([key, val]) => {
      if (val != null) {
        root.style.setProperty(key, String(val));
      } else {
        root.style.removeProperty(key);
      }
    });
    // Sweep vars the active builder doesn't emit (glass material/chart vars
    // after toggling glass off) so the globals.css defaults come back live.
    for (const key of THEME_VAR_KEYS) {
      if (!(key in activeStyle)) root.style.removeProperty(key);
    }

    if (liquidGlass) {
      root.setAttribute('data-glass', '');
      root.setAttribute('data-glass-scheme', resolvedScheme);
    } else {
      root.removeAttribute('data-glass');
      root.removeAttribute('data-glass-scheme');
    }

    // Keep the status/tab bar color in sync (SSR renders a static dark value).
    const themeColor = liquidGlass
      ? glassThemeColor(resolvedScheme)
      : String(activeStyle['--hpr-inkSoft'] ?? '#0a0a0a');
    let meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) {
      meta = document.createElement('meta');
      meta.setAttribute('name', 'theme-color');
      document.head.appendChild(meta);
    }
    meta.setAttribute('content', themeColor);

    // Persist the resolved vars so the pre-paint bootstrap script (root layout)
    // can replay them onto <html> on the next load, avoiding the theme snap.
    // Glass persists BOTH schemes so `system` mode resolves flash-free at boot.
    const payload: PersistedThemeVars = liquidGlass
      ? {
          __glass: {
            scheme: glassMode,
            tcLight: glassThemeColor('light'),
            tcDark: glassThemeColor('dark'),
          },
          __light: buildGlassThemeStyle('light', glassIntensity),
          __dark: buildGlassThemeStyle('dark', glassIntensity),
        }
      : (customStyle as Record<string, string>);
    try {
      localStorage.setItem(THEME_VARS_STORAGE_KEY, JSON.stringify(payload));
    } catch {
      // best-effort — a full / disabled localStorage just means the next load snaps
    }
  }, [
    accent,
    palette,
    gradient,
    font,
    fg,
    fgMute,
    fgSubtle,
    liquidGlass,
    glassMode,
    glassIntensity,
    resolvedScheme,
    hasHydrated,
  ]);

  return null;
}
