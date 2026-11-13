'use client';
import { useSyncExternalStore } from 'react';
import { getBrowseFreshness, subscribeBrowseFreshness } from '@/lib/browse-freshness';
import { formatTime } from '@/lib/date-format';
export function BrowseFreshnessNotice({ onRetry }: { onRetry: () => void }) {
  const at = useSyncExternalStore(subscribeBrowseFreshness, getBrowseFreshness, () => 0);
  if (!at) return null;
  return <BrowseFreshnessBanner at={at} onRetry={onRetry} />;
}

/**
 * A pill fixed just above the bottom tab bar (and the now-playing or a floating
 * action bar), so it stays in view however far the page is scrolled: in the
 * page flow at the top of <main>, Calendar's jump to today scrolled it ~950px
 * out of sight on an offline start, and nothing on screen said the data was
 * old. Toasts come from the top on a phone, so this spot is free; while it
 * shows, <main> adds its height to the bottom padding (globals.css,
 * --browse-notice-clearance) so the page's last row stays clear of it.
 */
export function BrowseFreshnessBanner({ at, onRetry }: { at: number; onRetry: () => void }) {
  return <div
    data-browse-notice
    className="pointer-events-none fixed right-0 z-30 flex justify-center"
    style={{
      left: 'var(--app-main-left, 0px)',
      // Out of <main>'s flow, so it keeps clear of a landscape notch itself;
      // the bottom inset is inside --footer-height.
      paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
      // Above the bars, and above the mini video player when one floats in the corner.
      bottom: 'calc(var(--footer-height) + var(--player-bar-height, 0px) + var(--floating-bar-clearance, 0px) + var(--mini-player-clearance, 0px) + 8px)',
    }}
  >
    <div role="status" className="pointer-events-auto flex max-w-full items-center gap-2 rounded-full bg-amber-950 pl-4 text-xs text-amber-100 shadow-lg"
      style={{ position: 'relative' }}>
      <span className="min-w-0">Showing saved browse data from {formatTime(at)}. Updates are unavailable.</span>
      <button type="button" className="underline pr-3" style={{ minHeight: 44, minWidth: 44, flexShrink: 0 }} onClick={onRetry}>Retry</button>
    </div>
  </div>;
}
