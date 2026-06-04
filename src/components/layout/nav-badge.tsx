'use client';

import { cn } from '@/lib/utils';
import type { BadgeSlice } from '@/types/badges';

/**
 * Nav count indicator. Renders nothing when the slice is empty. Shows `total`
 * (capped at 99+) in a muted pill, switching to red when there are attention
 * items. In `dot` mode it renders just a colored dot — for the collapsed
 * sidebar and the bottom-nav "More" button where there's no room for a number.
 */
export function NavBadge({
  slice,
  dot = false,
  className,
}: {
  slice: BadgeSlice | undefined;
  dot?: boolean;
  className?: string;
}) {
  if (!slice || slice.total <= 0) return null;
  const attention = slice.attention > 0;

  if (dot) {
    return (
      <span
        aria-hidden
        className={cn(
          'h-2 w-2 rounded-full',
          attention ? 'bg-destructive' : 'bg-muted-foreground/70',
          className,
        )}
      />
    );
  }

  return (
    <span
      className={cn(
        'inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold leading-none tabular-nums',
        attention ? 'bg-destructive text-white' : 'bg-muted text-muted-foreground',
        className,
      )}
    >
      {slice.total > 99 ? '99+' : slice.total}
    </span>
  );
}
