'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';
import { buildDashboardThemeStyle } from '@/lib/dashboard-theme';

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
  }, [accent, palette, gradient, font, fg, fgMute, fgSubtle, hasHydrated]);

  return null;
}
