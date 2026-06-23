'use client';

import type { RefObject } from 'react';
import { Loader2 } from 'lucide-react';
import { usePullToRefresh } from '@/lib/hooks/use-pull-to-refresh';

interface PullToRefreshProps {
  /** Refresh action; the spinner stays until the returned promise settles. */
  onRefresh: () => unknown | Promise<unknown>;
  /** Skip the gesture (e.g. during bulk-selection). */
  disabled?: boolean;
  /** Optional scroll container that must be at the top before refresh can trigger. */
  scrollContainerRef?: RefObject<HTMLElement | null>;
}

/**
 * Pull-to-refresh indicator for document-scrolled pages, or a provided scroll
 * container. Renders a fixed spinner that follows the finger and spins while
 * refreshing. Drop one instance near the top of a page; it owns no layout space.
 */
export function PullToRefresh({ onRefresh, disabled = false, scrollContainerRef }: PullToRefreshProps) {
  const { distance, progress, refreshing } = usePullToRefresh({ onRefresh, disabled, scrollContainerRef });

  const visible = refreshing || distance > 0;
  if (!visible) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 z-40 flex justify-center"
      style={{ top: 'calc(var(--header-height, 0px) + 4px)' }}
    >
      <div
        className="flex h-9 w-9 items-center justify-center rounded-full border border-border bg-background/90 shadow-md backdrop-blur"
        style={{
          transform: `translateY(${distance}px)`,
          opacity: refreshing ? 1 : Math.max(0.2, progress),
          transition: distance === 0 ? 'transform 150ms ease, opacity 150ms ease' : undefined,
        }}
      >
        <Loader2
          className={`h-5 w-5 text-foreground ${refreshing ? 'animate-spin' : ''}`}
          style={refreshing ? undefined : { transform: `rotate(${progress * 270}deg)` }}
        />
      </div>
    </div>
  );
}
