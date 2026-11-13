'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useEffect, useMemo, useState } from 'react';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  ResponsiveMenu,
  ResponsiveMenuCheckboxItem,
} from '@/components/ui/responsive-menu';
import { Filter, Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { InstanceFilter, type InstanceOption, withAppName } from '@/components/instance-filter';
import { useCan } from '@/components/permission-provider';
import { ActiveFilterBar, FilterDot, filterButtonLabel, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { HistoryEventDrawer, HistoryEventRow, type HistoryRecord } from '../_components/history-event';

// --- Event type config ---

type EventFilterKey = 'all' | 'grabbed' | 'imported' | 'failed' | 'deleted' | 'renamed' | 'ignored';

interface EventFilterOption {
  key: EventFilterKey;
  label: string;
}

const EVENT_FILTERS: EventFilterOption[] = [
  { key: 'all', label: 'All Events' },
  { key: 'grabbed', label: 'Grabbed' },
  { key: 'imported', label: 'Imported' },
  { key: 'failed', label: 'Failed' },
  { key: 'deleted', label: 'Deleted' },
  { key: 'renamed', label: 'Renamed' },
  { key: 'ignored', label: 'Ignored' },
];

/**
 * Renders the History page UI including event and instance filters, a paginated list of history events, and a detail drawer for a selected event.
 *
 * The page supports server-side filtering by event type and instance, infinite "Load more" pagination, and displays event metadata and contextual information in a drawer when an item is selected.
 *
 * @returns The React element for the History page.
 */

type HistoryResponse = {
  records?: HistoryRecord[];
  totalRecords?: number;
  hasMore?: boolean;
  truncated?: boolean;
};

function buildHistoryUrl(p: number, eventFilter: EventFilterKey, instanceFilter: string) {
  const params = new URLSearchParams({ page: String(p), pageSize: '20' });
  if (eventFilter !== 'all') params.set('eventType', eventFilter);
  if (instanceFilter !== 'all') params.set('instanceId', instanceFilter);
  return `/api/activity/history?${params}`;
}

export default function HistoryPage() {
  const [eventFilter, setEventFilter] = useRouteViewState<EventFilterKey>('eventFilter', 'all');
  const [instanceFilter, setInstanceFilter] = useRouteViewState<string>('instanceFilter', 'all');
  const [selectedItem, setSelectedItem] = useState<HistoryRecord | null>(null);

  // Infinite list: the filters live in the query key, so changing them swaps the
  // key and refetches from page 1 (no manual reset). "Load more" → fetchNextPage,
  // gated on the server's continuation contract. The total fallback preserves
  // compatibility with older responses during a rolling update.
  const {
    data,
    isLoading: loading,
    isError,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
  } = useInfiniteQuery({
    queryKey: ['activity', 'history', { eventFilter, instanceFilter }],
    queryFn: ({ pageParam, signal }) =>
      jsonFetcher<HistoryResponse>(buildHistoryUrl(pageParam, eventFilter, instanceFilter))({ signal }),
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) => {
      if (typeof lastPage.hasMore === 'boolean') {
        return lastPage.hasMore ? allPages.length + 1 : undefined;
      }
      const loaded = allPages.reduce((sum, pg) => sum + (pg.records?.length ?? 0), 0);
      return loaded < (lastPage.totalRecords ?? 0) ? allPages.length + 1 : undefined;
    },
    // Keep the current list on screen while an event/instance filter change
    // refetches, so the page never blanks to a full-screen spinner.
    placeholderData: keepPreviousData,
  });

  // The old code surfaced the initial fetch failure as a toast; preserve that.
  // (A failed "Load more" just doesn't append, matching the other infinite lists.)
  useEffect(() => {
    if (isError) toast.error('Failed to load history');
  }, [isError]);

  const history = useMemo(
    () => data?.pages.flatMap((pg) => pg.records ?? []) ?? [],
    [data],
  );
  const historyTruncated = data?.pages.some((page) => page.truncated) ?? false;

  // Load arr instances for the per-instance filter, independent of the (possibly
  // filtered) history so the options never collapse to the current selection.
  // The server leaves Lidarr out without music.view, so its instances aren't offered.
  const canViewMusic = useCan('music.view');
  const { data: instanceOptions = [] } = useQuery({
    // Distinct from queryKeys.instances() (['instances','all'] → /api/services); this
    // is the /api/instances connection list for the filter. Shares with the activity
    // page's same-key query, and can't prefix-collide with the services key.
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    select: (conns): InstanceOption[] =>
      Array.isArray(conns)
        ? conns
          .filter((c) => c.type !== 'LIDARR' || canViewMusic)
          .map((c) => ({ id: c.id, label: withAppName(c.label, c.type) }))
        : [],
    staleTime: 5 * 60_000,
  });

  // Drop a stale instance selection if that instance no longer exists. Correcting
  // invalid local state against freshly-loaded options is a legitimate effect.
  useEffect(() => {
    if (instanceFilter !== 'all' && !instanceOptions.some((i) => i.id === instanceFilter)) {

      setInstanceFilter('all');
    }
  }, [instanceOptions, instanceFilter, setInstanceFilter]);

  const activeFilterLabel = EVENT_FILTERS.find((f) => f.key === eventFilter)?.label || 'All Events';
  const activeFilters: ActiveFilter[] = [
    ...(eventFilter !== 'all' ? [{ id: 'event', label: activeFilterLabel, onRemove: () => setEventFilter('all') }] : []),
    ...(instanceFilter !== 'all'
      ? [{
        id: 'instance',
        label: instanceOptions.find((i) => i.id === instanceFilter)?.label ?? 'Instance',
        onRemove: () => setInstanceFilter('all'),
      }]
      : []),
  ];
  const clearFilters = () => {
    setEventFilter('all');
    setInstanceFilter('all');
  };

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <PageHeader
        title="History"
        rightContent={
          <div className="flex items-center gap-2">
            <InstanceFilter instances={instanceOptions} value={instanceFilter} onChange={setInstanceFilter} />
            <ResponsiveMenu
              title="Event"
              titleInDropdown
              closeOnPick
              align="end"
              trigger={(
                <Button
                  variant="ghost"
                  size="icon"
                  className="relative h-8 w-8"
                  aria-label={filterButtonLabel(`Event: ${activeFilterLabel}`, eventFilter !== 'all')}
                >
                  <Filter className="h-4 w-4" />
                  <FilterDot active={eventFilter !== 'all'} />
                </Button>
              )}
            >
              {EVENT_FILTERS.map((opt) => (
                <ResponsiveMenuCheckboxItem
                  key={opt.key}
                  checked={eventFilter === opt.key}
                  onCheckedChange={() => setEventFilter(opt.key)}
                >
                  {opt.label}
                </ResponsiveMenuCheckboxItem>
              ))}
            </ResponsiveMenu>
          </div>
        }
      />

      <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} className="pb-2" />

      {/* History list */}
      <div data-scroll-restoration-key="activity-history" className="page-bleed flex-1 pb-4">
        {loading ? (
          <PageSpinner />
        ) : history.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground">
            <p className="text-sm">{activeFilters.length > 0 ? 'No history events match your filters' : 'No history events'}</p>
            {historyTruncated && (
              <p className="mt-2 text-xs text-amber-400">
                More matching history may exist beyond the scan limit.
              </p>
            )}
          </div>
        ) : (
          <div className="space-y-1 animate-list-in">
            {history.map((item, i) => (
              <HistoryEventRow
                key={`${item.source}-${item.instanceId ?? ''}-${item.id}-${i}`}
                item={item}
                onSelect={() => setSelectedItem(item)}
              />
            ))}

            {/* Load more */}
            {hasNextPage && (
              <Button
                variant="ghost"
                className="w-full mt-2"
                onClick={() => fetchNextPage()}
                disabled={isFetchingNextPage}
              >
                {isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Load more
              </Button>
            )}
            {historyTruncated && !hasNextPage && (
              <p className="px-3 py-2 text-center text-xs text-amber-400">
                More matching history may exist beyond the scan limit.
              </p>
            )}
          </div>
        )}
      </div>

      {/* History item detail drawer */}
      <HistoryEventDrawer item={selectedItem} onClose={() => setSelectedItem(null)} />
    </div>
  );
}
