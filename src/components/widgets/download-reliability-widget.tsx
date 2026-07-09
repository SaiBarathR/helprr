'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ApiError } from '@/lib/query-fetch';
import type { WidgetProps } from '@/lib/widgets/types';
import type { InsightsDownloadsResponse } from '@/types/insights';
import { HPR } from './bento-primitives';
import { EmptyChartState } from './prowlarr-stats-shared';
import { DaysPill } from './widget-filter-controls';
import { useWidgetFilter } from './use-widget-filter';
import { InsightsWidgetFrame, INSIGHTS_DAYS_OPTIONS, daysToRange } from './insights-widget-frame';
import { SuccessRing } from '@/components/insights/insights-shared';

const DownloadSuccessChart = dynamic(
  () => import('@/components/insights/download-success-card').then((m) => m.DownloadSuccessChart),
  { ssr: false, loading: () => <EmptyChartState message="Loading…" /> },
);

function Chip({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 600, fontSize: 18, color }}>
        {value.toLocaleString()}
      </span>
      <span className="inline-flex items-center gap-1.5 text-[10px]" style={{ color: HPR.fgMute }}>
        <span style={{ width: 7, height: 7, borderRadius: 2, background: color }} />
        {label}
      </span>
    </div>
  );
}

async function fetchDownloads(days: number, signal?: AbortSignal): Promise<InsightsDownloadsResponse> {
  const { from, to } = daysToRange(days);
  const res = await fetch(`/api/insights/downloads?from=${from}&to=${to}`, { signal });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

export function DownloadReliabilityWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter('download-reliability', { days: 30 });
  const fetchFn = React.useCallback(
    (signal?: AbortSignal) => fetchDownloads(filters.days, signal),
    [filters.days],
  );

  return (
    <InsightsWidgetFrame<InsightsDownloadsResponse>
      title="Download Reliability"
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
      cacheKey={`insights-downloads-${filters.days}`}
      isEmpty={(d) => !d || d.totals.grabbed + d.totals.imported + d.totals.failed === 0}
      emptyMessage="No download history for this range."
    >
      {(data, { width }) => {
        const resolved = data.totals.imported + data.totals.failed;
        // Stack the ring above the chips on narrow cells so the row never
        // overflows the widget horizontally.
        const stack = width < 300;
        return (
          <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0, gap: 12 }}>
            <div className={stack ? 'flex flex-col items-start gap-3' : 'flex flex-row items-center flex-wrap gap-5'}>
              {data.successRate != null && <SuccessRing pct={data.successRate} />}
              <div className="flex items-center gap-4 flex-wrap">
                <Chip label="Grabbed" value={data.totals.grabbed} color={HPR.amber} />
                <Chip label="Imported" value={data.totals.imported} color={HPR.green} />
                <Chip label="Failed" value={data.totals.failed} color={HPR.rose} />
              </div>
            </div>
            {resolved > 0 ? (
              <div style={{ flex: 1, minHeight: 120 }}>
                <DownloadSuccessChart data={data} />
              </div>
            ) : (
              <div className="text-xs" style={{ color: HPR.fgSubtle }}>
                Grabs found, but nothing imported or failed in this window yet.
              </div>
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
