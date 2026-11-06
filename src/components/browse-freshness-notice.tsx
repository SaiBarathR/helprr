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
 * No safe-area insets here on purpose. This banner is in normal flow inside
 * AppShell's `<main>`, which already owns them: `.app-main` adds the top inset
 * in bottom-nav mode (in top-nav mode the nav itself covers that strip), and
 * keeps its content clear of the left/right insets of a landscape notch.
 * Reserving the top one again left ~59px of empty amber above the text on an
 * iPhone PWA, and the side ones would double the landscape gutter.
 */
export function BrowseFreshnessBanner({ at, onRetry }: { at: number; onRetry: () => void }) {
  return <div role="status" className="flex items-center justify-center gap-3 bg-amber-950 px-3 py-2 text-xs text-amber-100"
    style={{ position: 'relative' }}>
    <span className="min-w-0">Showing saved browse data from {formatTime(at)}. Updates are unavailable.</span>
    <button type="button" className="underline" style={{ minHeight: 44, minWidth: 44, flexShrink: 0 }} onClick={onRetry}>Retry</button>
  </div>;
}
