'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { useMemo, useState } from 'react';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Calendar } from '@/components/ui/calendar';
import type { DateRange } from 'react-day-picker';
import {
  Loader2,
  Clock,
  CalendarIcon,
  ChevronDown,
} from 'lucide-react';
import type { CustomHistoryItem } from '@/types/jellyfin';
import { CustomHistoryRow, PluginNotice, toDateStr } from './shared';

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// Tab 3: HISTORY (uses submit_custom_query — single API call)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

const QUICK_RANGES = [
  { label: '1d', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '3m', days: 90 },
];

const PAGE_SIZE = 50;

export function HistoryTab() {
  const [selectedUserId, setSelectedUserId] = useRouteViewState<string>('HistoryTab:selectedUserId', '');
  const [selectedFilter, setSelectedFilter] = useRouteViewState<string>('HistoryTab:selectedFilter', '');
  const [dateRange, setDateRange] = useRouteViewState<DateRange>('history:dateRange', () => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - 6);
    return { from, to };
  });
  const [calendarOpen, setCalendarOpen] = useState(false);

  // Users + filters for the dropdowns (loaded once).
  const userListQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'user-list'],
    queryFn: jsonFetcher<{ users?: { name: string; id: string }[]; pluginAvailable?: boolean }>(
      '/api/jellyfin/playback/user-list'
    ),
    staleTime: 60_000,
  });
  const filtersQuery = useQuery({
    queryKey: ['jellyfin', 'playback', 'filters'],
    queryFn: jsonFetcher<{ filters?: string[] }>('/api/jellyfin/playback/filters'),
    select: (d) => d.filters ?? [],
    staleTime: 60_000,
  });

  const fromDateStr = dateRange.from ? toDateStr(dateRange.from) : null;
  const toDateStrVal = dateRange.from ? toDateStr(dateRange.to || dateRange.from) : null;

  // Paginated history (offset-based "load more") → useInfiniteQuery keyed on the
  // active filters; changing any filter is a new key (fresh page 0).
  const historyQuery = useInfiniteQuery({
    queryKey: [
      'jellyfin', 'playback', 'custom-history',
      { from: fromDateStr, to: toDateStrVal, userId: selectedUserId, type: selectedFilter },
    ],
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({
        from: fromDateStr!,
        to: toDateStrVal!,
        limit: String(PAGE_SIZE),
        offset: String(pageParam),
      });
      if (selectedUserId) params.set('userId', selectedUserId);
      if (selectedFilter) params.set('type', selectedFilter);
      return jsonFetcher<{ items?: CustomHistoryItem[]; total?: number; pluginAvailable?: boolean }>(
        `/api/jellyfin/playback/custom-history?${params}`
      )({ signal });
    },
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      // An empty page means we've reached the end even if `total` over-reports —
      // otherwise the offset stalls and "Load more" refetches the same page.
      if (!lastPage.items?.length) return undefined;
      const loaded = allPages.reduce((n, p) => n + (p.items?.length ?? 0), 0);
      return loaded < (lastPage.total ?? 0) ? loaded : undefined;
    },
    staleTime: 60_000,
    enabled: !!dateRange.from,
  });

  const users = userListQuery.data?.users ?? [];
  const filters = filtersQuery.data ?? [];
  const items = useMemo(
    () => historyQuery.data?.pages.flatMap((p) => p.items ?? []) ?? [],
    [historyQuery.data]
  );
  const total = historyQuery.data?.pages[0]?.total ?? 0;
  const loading = historyQuery.isLoading;
  const loadingMore = historyQuery.isFetchingNextPage;
  // Plugin reports its absence via either meta endpoint or the history payload.
  const pluginAvailable =
    userListQuery.data?.pluginAvailable !== false &&
    historyQuery.data?.pages[0]?.pluginAvailable !== false;

  function applyQuickRange(days: number) {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    setDateRange({ from, to });
  }

  if (!pluginAvailable) return <PluginNotice />;

  const fromStr = dateRange.from ? dateRange.from.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '';
  const toStr = dateRange.to ? dateRange.to.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : fromStr;
  const rangeLabel = fromStr === toStr ? fromStr : `${fromStr} — ${toStr}`;
  // hasNextPage, not items.length < total: getNextPageParam stops on an empty
  // page even when `total` over-reports, and the button must disappear with it.
  const hasMore = historyQuery.hasNextPage;

  return (
    <div className="space-y-3">
      {/* Quick range buttons */}
      <div className="flex gap-1.5">
        {QUICK_RANGES.map((r) => (
          <button key={r.label} onClick={() => applyQuickRange(r.days)} className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors">
            {r.label}
          </button>
        ))}
      </div>

      {/* Date range picker */}
      <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
        <PopoverTrigger asChild>
          <Button variant="outline" className="w-full justify-start text-left text-xs h-9 font-normal">
            <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
            {rangeLabel}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start">
          <Calendar
            mode="range"
            selected={dateRange}
            onSelect={(range) => {
              if (range) setDateRange(range);
              if (range?.to) setCalendarOpen(false);
            }}
            disabled={{ after: new Date() }}
            numberOfMonths={1}
          />
        </PopoverContent>
      </Popover>

      {/* User + type filters */}
      <div className="flex gap-2">
        <Select value={selectedUserId || 'all'} onValueChange={(v) => setSelectedUserId(v === 'all' ? '' : v)}>
          <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="All users" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All users</SelectItem>
            {users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {filters.length > 0 && (
          <Select value={selectedFilter || 'all'} onValueChange={(v) => setSelectedFilter(v === 'all' ? '' : v)}>
            <SelectTrigger className="h-8 text-xs flex-1"><SelectValue placeholder="All types" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All types</SelectItem>
              {filters.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
      </div>

      {/* Result count */}
      {!loading && total > 0 && (
        <p className="text-[11px] text-muted-foreground">{total} plays found</p>
      )}

      {/* History list */}
      {loading ? (
        <PageSpinner />
      ) : items.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground"><Clock className="h-8 w-8 mx-auto mb-2 opacity-40" /><p className="text-sm">No plays found</p></div>
      ) : (
        <>
          <div className="space-y-1">{items.map((e) => <CustomHistoryRow key={e.RowId} item={e} />)}</div>
          {hasMore && (
            <Button variant="outline" className="w-full text-xs h-9" onClick={() => historyQuery.fetchNextPage()} disabled={loadingMore}>
              {loadingMore ? <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" /> : <ChevronDown className="h-3.5 w-3.5 mr-2" />}
              Load more ({items.length} of {total})
            </Button>
          )}
        </>
      )}
    </div>
  );
}
