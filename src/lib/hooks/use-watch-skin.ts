'use client';

import { useUIStore } from '@/lib/store';
import type { WatchSkinPreference } from '@/lib/store';

/**
 * The Watch section's presentation skin, safe to branch on during render.
 *
 * The preference lives in localStorage, which the server can't read, so the
 * server always renders `classic`. Gating on `hasHydrated` makes the first
 * client render agree with it and swap on the next — the same contract the
 * rest of the app uses for persisted prefs.
 *
 * The palette half of the skin does not wait for this: THEME_BOOTSTRAP_SCRIPT
 * stamps `data-watch-skin` on <html> pre-paint, so a cinematic user's ground,
 * accent and radius are correct on the very first frame. Only the component
 * structure swaps here.
 */
export function useWatchSkin(): WatchSkinPreference {
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const watchSkin = useUIStore((s) => s.watchSkin);
  return hasHydrated ? watchSkin : 'classic';
}
