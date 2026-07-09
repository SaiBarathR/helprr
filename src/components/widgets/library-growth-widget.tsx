'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ApiError } from '@/lib/query-fetch';
import type { WidgetProps } from '@/lib/widgets/types';
import type { InsightsLibraryResponse } from '@/types/insights';
import { HPR } from './bento-primitives';
import { EmptyChartState } from './prowlarr-stats-shared';
import { DaysPill } from './widget-filter-controls';
import { useWidgetFilter } from './use-widget-filter';
import { InsightsWidgetFrame, INSIGHTS_DAYS_OPTIONS, daysToRange } from './insights-widget-frame';

// Chart lives in the insights card module (imports recharts); load it lazily so
// recharts stays out of the dashboard's initial chunk.
const LibraryGrowthChart = dynamic(
  () => import('@/components/insights/library-growth-card').then((m) => m.LibraryGrowthChart),
  { ssr: false, loading: () => <EmptyChartState message="Loading…" /> },
);

// Recharts-free config, duplicated inline (a static import from the card would
// drag recharts into this eagerly-loaded widget).
const SERIES = [
  { key: 'Movies', field: 'movies' as const, color: HPR.blue },
  { key: 'Series', field: 'series' as const, color: HPR.purple },
  { key: 'Music', field: 'music' as const, color: HPR.pink },
];

async function fetchLibrary(days: number, signal?: AbortSignal): Promise<InsightsLibraryResponse> {
  const { from, to } = daysToRange(days);
  const res = await fetch(`/api/insights/library?from=${from}&to=${to}`, { signal });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

export function LibraryGrowthWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter('library-growth', { days: 30 });
  const fetchFn = React.useCallback(
    (signal?: AbortSignal) => fetchLibrary(filters.days, signal),
    [filters.days],
  );

  return (
    <InsightsWidgetFrame<InsightsLibraryResponse>
      title="Library Growth"
      badge={
        <DaysPill
          value={filters.days}
          options={INSIGHTS_DAYS_OPTIONS}
          onChange={(days) => setFilters({ days })}
          disabled={editMode}
          narrow={narrow}
        />
      }
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchFn}
      cacheKey={`insights-library-${filters.days}`}
      isEmpty={(d) => !d || d.days.length === 0 || SERIES.every((s) => d.series[s.field] == null)}
      emptyMessage="No library data for this range."
    >
      {(data) => {
        const active = SERIES.filter((s) => data.series[s.field] != null);
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 6 }}>
            <div className="flex items-center gap-3 flex-wrap">
              {active.map((s) => (
                <span
                  key={s.key}
                  className="inline-flex items-center gap-1.5 text-[11px]"
                  style={{ color: HPR.fgMute }}
                >
                  <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                  {s.key}
                  {data.totals[s.field] != null && (
                    <span style={{ fontFamily: 'var(--hpr-font-mono)' }}> {data.totals[s.field]!.toLocaleString()}</span>
                  )}
                </span>
              ))}
            </div>
            <div style={{ flex: 1, minHeight: 140 }}>
              <LibraryGrowthChart data={data} />
            </div>
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
