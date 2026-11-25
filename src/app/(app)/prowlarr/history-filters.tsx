'use client';

import type { ReactNode } from 'react';
import { ArrowDownWideNarrow, ArrowUpNarrowWide } from 'lucide-react';
import type { ActiveFilter } from '@/components/ui/active-filter-bar';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
  ResponsiveMenuLabel,
  ResponsiveMenuSeparator,
} from '@/components/ui/responsive-menu';
import { cn } from '@/lib/utils';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
import { FilterButton } from './filter-button';
import { historyEventLabel } from './history-events';

// eventType values are Prowlarr's HistoryEventType: 1 grab, 2 query, 3 RSS,
// 4 auth, 5 info. Failed uses successful=false instead of an event type.
export const HISTORY_FILTERS = [
  { label: 'All', value: '', eventType: undefined, successful: undefined },
  { label: historyEventLabel('releaseGrabbed'), value: '1', eventType: '1', successful: undefined },
  { label: historyEventLabel('indexerQuery'), value: '2', eventType: '2', successful: undefined },
  { label: historyEventLabel('indexerRss'), value: '3', eventType: '3', successful: undefined },
  { label: historyEventLabel('indexerAuth'), value: '4', eventType: '4', successful: undefined },
  { label: historyEventLabel('indexerInfo'), value: '5', eventType: '5', successful: undefined },
  { label: 'Failed', value: 'failed', eventType: undefined, successful: 'false' },
] as const;

export type HistoryFilterValue = typeof HISTORY_FILTERS[number]['value'];
export type HistorySort = 'newest' | 'oldest';

/** A chip for the event and for the indexer, each clearing its own. */
export function historyActiveFilters({ activeFilter, onFilterChange, indexerId, indexerLabel, onIndexerChange }: {
  activeFilter: HistoryFilterValue;
  onFilterChange: (value: HistoryFilterValue) => void;
  indexerId: number | null;
  indexerLabel: string;
  onIndexerChange: (id: number | null) => void;
}): ActiveFilter[] {
  const event = activeFilter === '' ? undefined : HISTORY_FILTERS.find((f) => f.value === activeFilter);
  return [
    ...(event ? [{ id: 'event', label: event.label, onRemove: () => onFilterChange('') }] : []),
    ...(indexerId !== null ? [{ id: 'indexer', label: indexerLabel, onRemove: () => onIndexerChange(null) }] : []),
  ];
}

/**
 * The History tab's one row: the record count, then the filter menu (event and
 * indexer, the funnel the Indexers and Stats tabs use) and the order toggle.
 */
export function HistoryFilterBar({
  summary,
  activeFilter,
  onFilterChange,
  indexerId,
  indexerOptions,
  onIndexerChange,
  sort,
  onSortChange,
}: {
  summary?: ReactNode;
  activeFilter: HistoryFilterValue;
  onFilterChange: (value: HistoryFilterValue) => void;
  indexerId: number | null;
  indexerOptions: ProwlarrIndexerSummary[];
  onIndexerChange: (id: number | null) => void;
  sort: HistorySort;
  onSortChange: (sort: HistorySort) => void;
}) {
  const oldestFirst = sort === 'oldest';
  const SortIcon = oldestFirst ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return (
    <div className="flex items-center gap-2">
      <div className="min-w-0 flex-1 text-xs text-muted-foreground">{summary}</div>
      <div className="flex shrink-0 items-center md:gap-2">
        <ResponsiveMenu
          title="Filter"
          titleInDropdown
          align="end"
          contentClassName="w-56 max-h-[min(32rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
          trigger={<FilterButton label="Filter" active={activeFilter !== '' || indexerId !== null} />}
        >
          <ResponsiveMenuLabel>Event</ResponsiveMenuLabel>
          {HISTORY_FILTERS.map((f) => (
            <ResponsiveMenuCheckboxItem key={f.value} checked={activeFilter === f.value} onCheckedChange={() => onFilterChange(f.value)}>
              {f.value === '' ? 'All events' : f.label}
            </ResponsiveMenuCheckboxItem>
          ))}
          <ResponsiveMenuSeparator />
          <ResponsiveMenuLabel>Indexer</ResponsiveMenuLabel>
          <ResponsiveMenuCheckboxItem checked={indexerId === null} onCheckedChange={() => onIndexerChange(null)}>
            All indexers
          </ResponsiveMenuCheckboxItem>
          {indexerOptions.map((indexer) => (
            <ResponsiveMenuCheckboxItem
              key={indexer.id}
              checked={indexerId === indexer.id}
              onCheckedChange={() => onIndexerChange(indexer.id)}
            >
              <span className="truncate">{indexer.name}</span>
            </ResponsiveMenuCheckboxItem>
          ))}
        </ResponsiveMenu>
        {/* One tap flips the order; the label says which order is showing, and oldest first is lit like a filter. */}
        <button
          type="button"
          aria-label={oldestFirst ? 'Oldest first. Show newest first' : 'Newest first. Show oldest first'}
          onClick={() => onSortChange(oldestFirst ? 'newest' : 'oldest')}
          className={cn(
            'flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center gap-1.5 rounded-lg p-2 text-sm font-medium transition-colors',
            oldestFirst ? 'bg-primary/15 text-primary' : 'hover:bg-accent active:bg-accent/80',
          )}
        >
          <SortIcon className="h-5 w-5 shrink-0" />
          <span className="hidden sm:inline">{oldestFirst ? 'Oldest' : 'Newest'}</span>
        </button>
      </div>
    </div>
  );
}
