'use client';

import { cn } from '@/lib/utils';
import type { BadgeArea, BadgeSlice } from '@/types/badges';

/**
 * Nav count indicator. Renders nothing when the slice is empty. Shows `total`
 * (capped at 99+) in a muted pill, switching to red when there are attention
 * items. In `dot` mode it renders just a colored dot — for the collapsed
 * sidebar, where there's no room for a number.
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
      {countText(slice.total)}
    </span>
  );
}

function countText(total: number): string {
  return total > 99 ? '99+' : String(total);
}

/**
 * A nav item's accessible name while it shows a count: its label, a pause,
 * then what the count is ("Notifications, 44 unread"), instead of the bare
 * "Notifications44" its text reads as. Undefined without a count, so the
 * item keeps its plain label. Activity counts the Arr download queue; the
 * other areas (downloading torrents, pending requests, new videos) and a
 * plain count say "items". 'more' is More's roll-up of mixed areas, "new";
 * a roll-up of only notifications passes 'notifications'.
 */
export function navBadgeName(label: string, slice: BadgeSlice | undefined, area: BadgeArea | 'more' | undefined): string | undefined {
  if (!slice || slice.total <= 0) return undefined;
  const what = area === 'notifications' ? 'unread'
    : area === 'more' ? 'new'
    : area === 'activity' ? 'in queue'
    : slice.total === 1 ? 'item' : 'items';
  return `${label}, ${countText(slice.total)} ${what}`;
}
