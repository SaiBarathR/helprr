'use client';
import { useSyncExternalStore } from 'react';
import { getBrowseFreshness, subscribeBrowseFreshness } from '@/lib/browse-freshness';
export function BrowseFreshnessNotice({ onRetry }: { onRetry: () => void }) {
  const at = useSyncExternalStore(subscribeBrowseFreshness, getBrowseFreshness, () => 0);
  if (!at) return null;
  return <div role="status" className="fixed inset-x-0 top-0 z-[100] flex items-center justify-center gap-3 bg-amber-950 px-3 py-2 text-xs text-amber-100">
    <span>Showing saved browse data from {new Date(at).toLocaleTimeString()}. Updates are unavailable.</span>
    <button type="button" className="underline" onClick={onRetry}>Retry</button>
  </div>;
}
