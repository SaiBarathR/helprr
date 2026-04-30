'use client';

import { useEffect } from 'react';
import { useUIStore } from '@/lib/store';

/**
 * Applies the persisted accent color by setting `data-accent` on the <html>
 * element. CSS rules in globals.css then override --primary, --amber, --ring,
 * and related tokens for that accent.
 *
 * Accent is stored per-device in localStorage via Zustand persist, so mobile
 * and desktop installs each remember their own choice automatically.
 */
export function AccentApplier() {
  const accentColor = useUIStore((s) => s.accentColor);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    document.documentElement.dataset.accent = accentColor;
  }, [accentColor]);

  return null;
}
