'use client';

import * as React from 'react';
import { useCan } from '@/components/permission-provider';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { toDateKey } from '@/components/insights/insights-shared';
import { shiftDayKey } from '@/lib/insights';
import { SectionHeader } from './bento-primitives';
import { EmptyChartState } from './prowlarr-stats-shared';
import type { DaysOption } from './widget-filter-controls';
import type { MediaAnalysisKindFilter } from '@/components/insights/technical-breakdown-card';

// Day windows offered by the range widgets (library growth, download
// reliability, pipeline). No "all time": the insights routes clamp the window
// to INSIGHTS_MAX_DAYS (366) server-side anyway, so 90d is the useful ceiling.
export const INSIGHTS_DAYS_OPTIONS: DaysOption[] = [
  { value: 7, label: '7 days' },
  { value: 14, label: '14 days' },
  { value: 30, label: '30 days' },
  { value: 90, label: '90 days' },
];

/** A per-widget `days` filter → the `{from,to}` YYYY-MM-DD the insights routes take. */
export function daysToRange(days: number): { from: string; to: string } {
  const to = toDateKey(new Date());
  const from = shiftDayKey(to, -(days - 1));
  return { from, to };
}

/**
 * Column count driven by the MEASURED body width, not viewport breakpoints —
 * a widget can be 200px wide on a 1440px monitor, so the cards' Tailwind
 * `sm:`/`min-[480px]:` grids are wrong here. ~`minColWidth` px per column,
 * capped at `maxCols`, floored at 1.
 */
export function gridColumns(width: number, minColWidth: number, maxCols: number): number {
  if (width <= 0) return 1;
  return Math.max(1, Math.min(maxCols, Math.floor(width / minColWidth)));
}

export interface InsightsWidgetFrameProps<T> {
  title: string;
  right?: React.ReactNode;
  badge?: React.ReactNode;
  refreshInterval: number;
  editMode?: boolean;
  refetchOnFocus?: boolean;
  fetchFn: () => Promise<T>;
  cacheKey: string;
  isEmpty: (data: T | null) => boolean;
  emptyMessage?: string;
  children: (data: T, size: { width: number; height: number }) => React.ReactNode;
}

/**
 * Frame shared by every insights-derived widget. Owns the flex column, the
 * SectionHeader, a measured + scrollable body, and the useWidgetData wiring
 * (polls, pauses when tab hidden, stops in edit mode). Filters live in the
 * widget: it passes `badge`/`right` controls plus a `fetchFn`/`cacheKey` that
 * already reflect the current filter.
 */
export function InsightsWidgetFrame<T>({
  title,
  right,
  badge,
  refreshInterval,
  editMode = false,
  refetchOnFocus = false,
  fetchFn,
  cacheKey,
  isEmpty,
  emptyMessage = 'No data for this period.',
  children,
}: InsightsWidgetFrameProps<T>) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { data, loading, error } = useWidgetData<T>({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey,
    refetchOnFocus,
  });

  const empty = isEmpty(data);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader title={title} badge={badge} right={right} />
      <div ref={ref} style={{ flex: 1, minHeight: 0, overflowX: 'hidden', overflowY: 'auto' }}>
        {error && (!data || empty) ? (
          <EmptyChartState message="Failed to load." />
        ) : loading && (!data || empty) ? (
          <EmptyChartState message="Loading…" />
        ) : !data || empty ? (
          <EmptyChartState message={emptyMessage} />
        ) : (
          children(data, { width, height })
        )}
      </div>
    </div>
  );
}

/**
 * All / Movies / Episodes scope toggle for the media-analysis widgets. Mirrors
 * the chips in technical-breakdown-card; only meaningful (and only rendered)
 * when the viewer can see both libraries — with one library, "All" already IS
 * that library.
 */
export function AnalysisScopeChips({
  value,
  onChange,
  disabled = false,
}: {
  value: MediaAnalysisKindFilter;
  onChange: (kind: MediaAnalysisKindFilter) => void;
  disabled?: boolean;
}) {
  const canMovies = useCan('movies.view');
  const canSeries = useCan('series.view');
  if (!canMovies || !canSeries) return null;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Analysis scope">
      {(['all', 'movie', 'episode'] as const).map((id) => (
        <button
          key={id}
          type="button"
          onClick={disabled ? undefined : () => onChange(id)}
          aria-pressed={value === id}
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
            value === id
              ? 'bg-primary/20 text-primary border border-primary/40'
              : 'bg-accent/40 text-muted-foreground border border-transparent hover:text-foreground'
          }`}
        >
          {id === 'all' ? 'All' : id === 'movie' ? 'Movies' : 'Episodes'}
        </button>
      ))}
    </div>
  );
}
