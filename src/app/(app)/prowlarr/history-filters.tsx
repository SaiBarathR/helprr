'use client';

import { ArrowDownWideNarrow, ArrowUpNarrowWide, ChevronDown } from 'lucide-react';
import { ResponsiveMenu, ResponsiveMenuCheckboxItem } from '@/components/ui/responsive-menu';
import type { ProwlarrIndexerSummary } from '@/lib/prowlarr-client';
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

const pillClass = (active: boolean) => `flex min-w-0 items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${active
  ? 'bg-primary text-primary-foreground'
  : 'bg-card border border-border text-muted-foreground hover:text-foreground'
  }`;

/**
 * The History tab's one row: event, indexer and order. Seven event pills do not
 * fit beside the indexer and order on a phone or a tablet, so below lg the
 * events are one menu, shaped like the indexer's.
 */
export function HistoryFilterBar({
  activeFilter,
  onFilterChange,
  indexerId,
  indexerLabel,
  indexerOptions,
  onIndexerChange,
  sort,
  onSortChange,
}: {
  activeFilter: HistoryFilterValue;
  onFilterChange: (value: HistoryFilterValue) => void;
  indexerId: number | null;
  indexerLabel: string;
  indexerOptions: ProwlarrIndexerSummary[];
  onIndexerChange: (id: number | null) => void;
  sort: HistorySort;
  onSortChange: (sort: HistorySort) => void;
}) {
  const eventLabel = activeFilter === '' ? 'All events' : HISTORY_FILTERS.find((f) => f.value === activeFilter)?.label ?? 'All events';
  const oldestFirst = sort === 'oldest';
  const SortIcon = oldestFirst ? ArrowUpNarrowWide : ArrowDownWideNarrow;

  return (
    <div className="flex items-center gap-1.5">
      <div className="min-w-0 lg:hidden">
        <ResponsiveMenu
          title="Event"
          titleInDropdown
          closeOnPick
          trigger={(
            <button type="button" aria-label={`Event: ${eventLabel}`} className={pillClass(activeFilter !== '')}>
              <span className="max-w-[7rem] truncate">{eventLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        >
          {HISTORY_FILTERS.map((f) => (
            <ResponsiveMenuCheckboxItem key={f.value} checked={activeFilter === f.value} onCheckedChange={() => onFilterChange(f.value)}>
              {f.value === '' ? 'All events' : f.label}
            </ResponsiveMenuCheckboxItem>
          ))}
        </ResponsiveMenu>
      </div>
      <div className="hidden lg:flex gap-1.5">
        {HISTORY_FILTERS.map((f) => (
          <button
            key={f.value}
            type="button"
            aria-pressed={activeFilter === f.value}
            onClick={() => onFilterChange(f.value)}
            className={pillClass(activeFilter === f.value)}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="min-w-0">
        <ResponsiveMenu
          title="Indexer"
          titleInDropdown
          closeOnPick
          contentClassName="max-h-[min(24rem,var(--radix-dropdown-menu-content-available-height))] overflow-y-auto"
          trigger={(
            <button type="button" aria-label={`Indexer: ${indexerLabel}`} className={pillClass(indexerId !== null)}>
              <span className="max-w-[9rem] truncate">{indexerLabel}</span>
              <ChevronDown className="h-3.5 w-3.5 shrink-0" />
            </button>
          )}
        >
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
      </div>
      {/* One tap flips the order; the label says which order is showing. */}
      <button
        type="button"
        aria-label={oldestFirst ? 'Oldest first. Show newest first' : 'Newest first. Show oldest first'}
        onClick={() => onSortChange(oldestFirst ? 'newest' : 'oldest')}
        className={`ml-auto shrink-0 ${pillClass(false)}`}
      >
        <SortIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="hidden sm:inline">{oldestFirst ? 'Oldest' : 'Newest'}</span>
      </button>
    </div>
  );
}
