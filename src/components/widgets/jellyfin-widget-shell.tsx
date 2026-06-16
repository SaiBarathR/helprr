'use client';

import * as React from 'react';
import { useCallback, useState } from 'react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useWidgetFilter } from './use-widget-filter';
import {
  DaysSelect,
  FilterRow,
  FilterIconButton,
  JELLYFIN_DAYS_OPTIONS,
  MAX_DAYS,
  SortTogglePill,
  UserSelect,
  WidgetFilterDrawer,
  type SortMode,
} from './widget-filter-controls';
import { SectionHeader, HPR } from './bento-primitives';

export interface JellyfinStatsFilters {
  days: number;
  userId: string;
  sortBy: SortMode;
}

const DEFAULT_FILTERS: JellyfinStatsFilters = { days: 3, userId: '', sortBy: 'duration' };

export interface JellyfinStatsRenderSize {
  width: number;
  height: number;
}

export interface JellyfinStatsWidgetShellProps<T> {
  widgetId: string;
  title: string;
  refreshInterval: number;
  editMode?: boolean;
  fetchFn: (params: { days: number; userId: string; signal?: AbortSignal }) => Promise<T>;
  renderContent: (data: T | null, sortBy: SortMode, size: JellyfinStatsRenderSize) => React.ReactNode;
  isEmpty: (data: T | null) => boolean;
  emptyMessage?: string;
  showSortToggle?: boolean;
  initialDays?: number;
  initialSort?: SortMode;
  /** Refetch on focus — opt-in per widget (live ones), off for the static charts. */
  refetchOnFocus?: boolean;
}

export function JellyfinStatsWidgetShell<T>(props: JellyfinStatsWidgetShellProps<T>) {
  const {
    widgetId,
    title,
    refreshInterval,
    editMode = false,
    fetchFn,
    renderContent,
    isEmpty,
    emptyMessage = 'No data for this period.',
    showSortToggle = false,
    initialDays,
    initialSort,
    refetchOnFocus = false,
  } = props;

  const defaults: JellyfinStatsFilters = {
    ...DEFAULT_FILTERS,
    ...(initialDays != null ? { days: initialDays } : {}),
    ...(initialSort != null ? { sortBy: initialSort } : {}),
  };
  const [filters, setFilters, resetFilters] = useWidgetFilter<JellyfinStatsFilters>(widgetId, defaults);
  const [drawerOpen, setDrawerOpen] = useState(false);

  const fetchWrapped = useCallback(() => {
    const queryDays = filters.days === 0 ? MAX_DAYS : filters.days;
    return fetchFn({ days: queryDays, userId: filters.userId });
  }, [filters.days, filters.userId, fetchFn]);

  const { data, loading } = useWidgetData<T>({
    fetchFn: fetchWrapped,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `${widgetId}-${filters.days}-${filters.userId || 'all'}`,
    refetchOnFocus,
  });

  const hasActiveFilters = filters.days !== defaults.days || filters.userId !== defaults.userId;

  const badge = (
    <FilterIconButton
      active={hasActiveFilters}
      onClick={() => setDrawerOpen(true)}
      disabled={editMode}
    />
  );

  const right = showSortToggle ? (
    <SortTogglePill
      value={filters.sortBy}
      onChange={(sortBy) => setFilters({ ...filters, sortBy })}
      disabled={editMode}
    />
  ) : undefined;

  const { ref: bodyRef, width: bodyWidth, height: bodyHeight } = useElementSize<HTMLDivElement>();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader title={title} badge={badge} right={right} />
      <div
        ref={bodyRef}
        style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}
      >
        {loading && (data === null || isEmpty(data)) ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
        ) : isEmpty(data) ? (
          <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>{emptyMessage}</div>
        ) : (
          renderContent(data, filters.sortBy, { width: bodyWidth, height: bodyHeight })
        )}
      </div>

      <WidgetFilterDrawer
        title={`${title} — Filters`}
        open={drawerOpen}
        onOpenChange={setDrawerOpen}
        onReset={resetFilters}
      >
        <FilterRow label="Range">
          <DaysSelect
            value={filters.days}
            onChange={(days) => setFilters({ ...filters, days })}
            options={JELLYFIN_DAYS_OPTIONS}
          />
        </FilterRow>
        <FilterRow label="User">
          <UserSelect value={filters.userId} onChange={(userId) => setFilters({ ...filters, userId })} />
        </FilterRow>
      </WidgetFilterDrawer>
    </div>
  );
}
