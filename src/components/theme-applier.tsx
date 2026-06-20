'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';
import { buildDashboardThemeStyle, THEME_VARS_STORAGE_KEY } from '@/lib/dashboard-theme';

export function ThemeApplier() {
  const accent = useUIStore((s) => s.dashboardAccent);
  const palette = useUIStore((s) => s.dashboardPalette);
  const gradient = useUIStore((s) => s.dashboardGradient);
  const font = useUIStore((s) => s.dashboardFont);
  const fg = useUIStore((s) => s.dashboardFg);
  const fgMute = useUIStore((s) => s.dashboardFgMute);
  const fgSubtle = useUIStore((s) => s.dashboardFgSubtle);
  const hasHydrated = useUIStore((s) => s.hasHydrated);

  useEffect(() => {
    if (!hasHydrated) return;

    const themeStyle = buildDashboardThemeStyle({
      accent,
      palette,
      gradient,
      font,
      fg,
      fgMute,
      fgSubtle,
    });
    const root = document.documentElement;

    Object.entries(themeStyle).forEach(([key, val]) => {
      if (val != null) {
        root.style.setProperty(key, String(val));
      } else {
        root.style.removeProperty(key);
      }
    });

    // Persist the resolved vars so the pre-paint bootstrap script (root layout)
    // can replay them onto <html> on the next load, avoiding the theme snap.
    try {
      localStorage.setItem(THEME_VARS_STORAGE_KEY, JSON.stringify(themeStyle));
    } catch {
      // best-effort — a full / disabled localStorage just means the next load snaps
    }
  }, [accent, palette, gradient, font, fg, fgMute, fgSubtle, hasHydrated]);

  return null;
}
