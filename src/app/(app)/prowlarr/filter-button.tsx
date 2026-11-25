'use client';

import type { ComponentProps } from 'react';
import { Filter } from 'lucide-react';
import { FilterDot, filterButtonLabel } from '@/components/ui/active-filter-bar';

/**
 * The filter menu's trigger on the Indexers, Stats and History tabs: the same
 * 44px funnel as Movies, Series and Torrents, with the dot while filters hide rows.
 */
export function FilterButton({ label, active, ...props }: ComponentProps<'button'> & { label: string; active: boolean }) {
  return (
    <button
      type="button"
      aria-label={filterButtonLabel(label, active)}
      className="relative p-2 min-h-[44px] min-w-[44px] flex shrink-0 items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
      {...props}
    >
      <Filter className="h-5 w-5" />
      <FilterDot active={active} />
    </button>
  );
}
