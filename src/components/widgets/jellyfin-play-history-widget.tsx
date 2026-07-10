'use client';

import { useCallback, useMemo, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ChevronDown, Loader2, Film, Tv, MonitorPlay } from 'lucide-react';
import type { DateRange } from 'react-day-picker';
import type { CustomHistoryItem } from '@/types/jellyfin';
import type { WidgetProps } from '@/lib/widgets/types';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useWidgetFilter } from './use-widget-filter';
import {
  DateRangeSelect,
  FilterIconButton,
  FilterRow,
  TypeSelect,
  UserSelect,
  WidgetFilterDrawer,
} from './widget-filter-controls';
import { SectionHeader, HPR } from './bento-primitives';
import { formatDurationSeconds } from '@/lib/jellyfin-helpers';

interface Filters {
  fromIso: string;
  toIso: string;
  userId: string;
  type: string;
}

const PAGE_SIZE = 50;

function defaultRange(): Filters {
  const to = new Date();
  const from = new Date();
  from.setDate(from.getDate() - 6);
  return {
    fromIso: from.toISOString(),
    toIso: to.toISOString(),
    userId: '',
    type: '',
  };
}

function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function formatDateCreated(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function formatDateCreatedShort(dateStr: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(dateStr));
  } catch {
    return dateStr;
  }
}

function getMethodColor(method: string): string {
  const m = method.toLowerCase();
  if (m.startsWith('directplay')) return 'text-green-500 border-green-500/30';
  if (m.startsWith('directstream')) return 'text-blue-500 border-blue-500/30';
  if (m.startsWith('transcode')) return 'text-orange-500 border-orange-500/30';
  return '';
}

interface HistoryResult {
  items: CustomHistoryItem[];
  total: number;
}

export function JellyfinPlayHistoryWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const defaults = useMemo(() => defaultRange(), []);
  const [filters, setFilters, resetFilters] = useWidgetFilter<Filters>('jellyfin-play-history', defaults);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [extraItems, setExtraItems] = useState<CustomHistoryItem[]>([]);
  const [extraOffset, setExtraOffset] = useState(0);
  const [loadingMore, setLoadingMore] = useState(false);

  const dateRange: DateRange = useMemo(
    () => ({
      from: filters.fromIso ? new Date(filters.fromIso) : undefined,
      to: filters.toIso ? new Date(filters.toIso) : undefined,
    }),
    [filters.fromIso, filters.toIso],
  );

  const fetchFn = useCallback(async (): Promise<HistoryResult> => {
    if (!filters.fromIso) return { items: [], total: 0 };
    const from = toDateStr(new Date(filters.fromIso));
    const to = toDateStr(new Date(filters.toIso || filters.fromIso));
    const params = new URLSearchParams({ from, to, limit: String(PAGE_SIZE), offset: '0' });
    if (filters.userId) params.set('userId', filters.userId);
    if (filters.type) params.set('type', filters.type);
    const res = await fetch(`/api/jellyfin/playback/custom-history?${params}`);
    if (!res.ok) return { items: [], total: 0 };
    const data = await res.json();
    return { items: data.items ?? [], total: data.total ?? 0 };
  }, [filters.fromIso, filters.toIso, filters.userId, filters.type]);

  const cacheKey = `jellyfin-play-history-${filters.fromIso}-${filters.toIso}-${filters.userId || 'all'}-${filters.type || 'all'}`;
  // Pause background refresh once the user has paged in extras: a refetch
  // would reset data to the first page and either drop or duplicate items at
  // the page boundary. Background polling resumes naturally on filter changes
  // (which reset extraItems back to []).
  const { data, loading } = useWidgetData<HistoryResult>({
    fetchFn,
    refreshInterval,
    enabled: !editMode && extraItems.length === 0,
    cacheKey,
  });

  // Reset paginated extras when filters change (cacheKey changes → fetch reruns)
  const items = useMemo(() => [...(data?.items ?? []), ...extraItems], [data, extraItems]);
  const total = data?.total ?? 0;
  const hasMore = items.length < total;

  async function loadMore() {
    const nextOffset = (extraOffset === 0 ? (data?.items?.length ?? 0) : extraOffset + PAGE_SIZE);
    if (!filters.fromIso) return;
    const filtersAtStart = filters;
    setLoadingMore(true);
    try {
      const from = toDateStr(new Date(filtersAtStart.fromIso));
      const to = toDateStr(new Date(filtersAtStart.toIso || filtersAtStart.fromIso));
      const params = new URLSearchParams({ from, to, limit: String(PAGE_SIZE), offset: String(nextOffset) });
      if (filtersAtStart.userId) params.set('userId', filtersAtStart.userId);
      if (filtersAtStart.type) params.set('type', filtersAtStart.type);
      const res = await fetch(`/api/jellyfin/playback/custom-history?${params}`);
      if (!res.ok) return;
      const d = await res.json();
      // Drop the response if filters changed mid-flight — the new query
      // already reset extraItems/extraOffset and we'd otherwise splice
      // rows from the old window into the new result.
      if (
        filtersAtStart.fromIso !== filters.fromIso ||
        filtersAtStart.toIso !== filters.toIso ||
        filtersAtStart.userId !== filters.userId ||
        filtersAtStart.type !== filters.type
      ) return;
      setExtraItems((prev) => [...prev, ...((d.items as CustomHistoryItem[]) ?? [])]);
      setExtraOffset(nextOffset);
    } finally {
      setLoadingMore(false);
    }
  }

  const hasActiveFilters =
    filters.userId !== defaults.userId ||
    filters.type !== defaults.type ||
    filters.fromIso !== defaults.fromIso ||
    filters.toIso !== defaults.toIso;

  const badge = (
    <FilterIconButton
      active={hasActiveFilters}
      onClick={() => setDrawerOpen(true)}
      disabled={editMode}
    />
  );

  function onRangeChange(range: DateRange) {
    setFilters({
      ...filters,
      fromIso: range.from ? range.from.toISOString() : '',
      toIso: range.to ? range.to.toISOString() : range.from ? range.from.toISOString() : '',
    });
    setExtraItems([]);
    setExtraOffset(0);
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader
        title="Play History"
        badge={badge}
        right={!loading && total > 0 ? <span>{total} plays</span> : undefined}
      />
      <div style={{ flex: 1, minHeight: 0, overflowY: 'auto' }} className="no-scrollbar">
        {loading && items.length === 0 ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
        ) : items.length === 0 ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>No plays found.</div>
        ) : (
          <>
            <div className="space-y-1">
              {items.map((item) => (
                <div key={item.RowId} className="flex items-center gap-3 py-1 rounded-lg hover:bg-muted/30 @max-[219px]/cell:gap-2">
                  <div className="p-1.5 rounded bg-muted shrink-0 @max-[219px]/cell:hidden">
                    {item.ItemType === 'Movie' ? (
                      <Film className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : item.ItemType === 'Episode' ? (
                      <Tv className="h-3.5 w-3.5 text-muted-foreground" />
                    ) : (
                      <MonitorPlay className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm truncate">{item.ItemName}</p>
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden text-[10px] text-muted-foreground">
                      <span className="min-w-0 truncate">{item.ClientName}</span>
                      {/* Device is tertiary — dropped on compact cells. */}
                      <span className="@max-[219px]/cell:hidden">·</span>
                      <span className="min-w-0 truncate @max-[219px]/cell:hidden">{item.DeviceName}</span>
                      <span>·</span>
                      <span className="shrink-0">{formatDurationSeconds(item.PlayDuration)}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 max-w-[50%] space-y-0.5">
                    <Badge variant="outline" className={`text-[9px] px-1 py-0 max-w-full ${getMethodColor(item.PlaybackMethod)}`}>
                      {/* "Transcode (v:direct a:direct)" → "Transcode" on compact cells. */}
                      <span className="truncate @max-[219px]/cell:hidden">{item.PlaybackMethod}</span>
                      <span className="hidden truncate @max-[219px]/cell:inline">{item.PlaybackMethod.split(' ')[0]}</span>
                    </Badge>
                    <p className="text-[10px] text-muted-foreground truncate @max-[219px]/cell:hidden">{formatDateCreated(item.DateCreated)}</p>
                    <p className="hidden text-[10px] text-muted-foreground truncate @max-[219px]/cell:block">{formatDateCreatedShort(item.DateCreated)}</p>
                  </div>
                </div>
              ))}
            </div>
            {hasMore && (
              <Button variant="outline" className="w-full text-xs h-9 mt-2" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin mr-2" />
                ) : (
                  <ChevronDown className="h-3.5 w-3.5 mr-2" />
                )}
                Load more ({items.length} of {total})
              </Button>
            )}
          </>
        )}
      </div>

      <WidgetFilterDrawer
        title="Play History — Filters"
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onReset={() => {
          resetFilters();
          setExtraItems([]);
          setExtraOffset(0);
        }}
      >
        <FilterRow label="Date range">
          <DateRangeSelect value={dateRange} onChange={onRangeChange} />
        </FilterRow>
        <FilterRow label="User">
          <UserSelect
            value={filters.userId}
            onChange={(userId) => {
              setFilters({ ...filters, userId });
              setExtraItems([]);
              setExtraOffset(0);
            }}
          />
        </FilterRow>
        <FilterRow label="Type">
          <TypeSelect
            value={filters.type}
            onChange={(type) => {
              setFilters({ ...filters, type });
              setExtraItems([]);
              setExtraOffset(0);
            }}
          />
        </FilterRow>
      </WidgetFilterDrawer>
    </div>
  );
}
