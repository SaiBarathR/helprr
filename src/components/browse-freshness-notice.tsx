'use client';
import { useSyncExternalStore } from 'react';
import { getBrowseFreshness, subscribeBrowseFreshness } from '@/lib/browse-freshness';
export function BrowseFreshnessNotice({ onRetry }: { onRetry: () => void }) {
  const at = useSyncExternalStore(subscribeBrowseFreshness, getBrowseFreshness, () => 0);
  if (!at) return null;
  return <BrowseFreshnessBanner at={at} onRetry={onRetry} />;
}

/**
 * No `safe-area-inset-top` here on purpose. This banner is in normal flow
 * inside AppShell's `<main>`, which already owns the top inset: `.app-main`
 * adds it in bottom-nav mode, and in top-nav mode the nav itself covers that
 * strip. Reserving it again left ~59px of empty amber above the text on an
 * iPhone PWA — the notice sits below the nav and never reaches the notch.
 * The left/right insets do stay: `.app-main` only pads 0.5rem inline, which
 * does not clear a landscape notch, so the text and the 44px Retry target
 * still need them.
 */
export function BrowseFreshnessBanner({ at, onRetry }: { at: number; onRetry: () => void }) {
  return <div role="status" className="flex items-center justify-center gap-3 bg-amber-950 py-2 text-xs text-amber-100"
    style={{
      position: 'relative',
      paddingLeft: 'max(0.75rem, env(safe-area-inset-left, 0px))',
      paddingRight: 'max(0.75rem, env(safe-area-inset-right, 0px))',
    }}>
    <span className="min-w-0">Showing saved browse data from {new Date(at).toLocaleTimeString()}. Updates are unavailable.</span>
    <button type="button" className="underline" style={{ minHeight: 44, minWidth: 44, flexShrink: 0 }} onClick={onRetry}>Retry</button>
  </div>;
}
