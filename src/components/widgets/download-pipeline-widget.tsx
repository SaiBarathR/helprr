'use client';

import * as React from 'react';
import dynamic from 'next/dynamic';
import { ApiError } from '@/lib/query-fetch';
import type { WidgetProps } from '@/lib/widgets/types';
import type { InsightsPipelineResponse } from '@/types/insights';
import { HPR, mix } from './bento-primitives';
import { EmptyChartState } from './prowlarr-stats-shared';
import { DaysPill } from './widget-filter-controls';
import { useWidgetFilter } from './use-widget-filter';
import { InsightsWidgetFrame, INSIGHTS_DAYS_OPTIONS, daysToRange, gridColumns } from './insights-widget-frame';
import { Stat, fmtWait } from '@/components/insights/insights-shared';

const PipelineHourChart = dynamic(
  () => import('@/components/insights/download-pipeline-card').then((m) => m.PipelineHourChart),
  { ssr: false, loading: () => <EmptyChartState message="Loading…" /> },
);

async function fetchPipeline(days: number, signal?: AbortSignal): Promise<InsightsPipelineResponse> {
  const { from, to } = daysToRange(days);
  const res = await fetch(`/api/insights/pipeline?from=${from}&to=${to}`, { signal });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

export function DownloadPipelineWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  const [filters, setFilters] = useWidgetFilter('download-pipeline', { days: 30 });
  const fetchFn = React.useCallback(
    (signal?: AbortSignal) => fetchPipeline(filters.days, signal),
    [filters.days],
  );

  return (
    <InsightsWidgetFrame<InsightsPipelineResponse>
      title="Download Pipeline"
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
      cacheKey={`insights-pipeline-${filters.days}`}
      isEmpty={(d) => !d || !(d.hours.some((h) => h > 0) || d.indexers.length > 0 || d.latency !== null)}
      emptyMessage="No download activity in this range."
    >
      {(data, { width }) => {
        const listCols = gridColumns(width, 240, 2);
        return (
          <div className="flex flex-col gap-4">
            {data.latency && (
              <div className="flex items-center gap-6 flex-wrap">
                <Stat label="Median grab→import" value={fmtWait(data.latency.medianMins)} color={HPR.green} />
                <Stat label="Slowest 10% take over" value={fmtWait(data.latency.p90Mins)} color={HPR.amber} />
                <Stat label="Completed downloads" value={String(data.latency.samples)} />
              </div>
            )}

            <div>
              <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                Activity by hour of day
              </p>
              <div style={{ height: 120 }}>
                <PipelineHourChart data={data} />
              </div>
            </div>

            {(data.indexers.length > 0 || data.releaseGroups.length > 0) && (
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: `repeat(${listCols}, minmax(0, 1fr))`,
                  gap: 16,
                }}
              >
                {data.indexers.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                      Indexer reliability
                    </p>
                    <div className="space-y-1">
                      {data.indexers.map((ix) => (
                        <div key={ix.name} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate" style={{ color: HPR.fg }}>{ix.name}</span>
                          <span className="tabular-nums" style={{ color: HPR.fgMute }}>{ix.grabs} grabs</span>
                          {ix.failures > 0 && (
                            <span
                              className="rounded px-1.5 py-0.5 text-[10px] font-medium tabular-nums"
                              style={{ background: mix(HPR.rose, 15), color: HPR.rose }}
                            >
                              {ix.failures} failed
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.releaseGroups.length > 0 && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                      Top release groups
                    </p>
                    <div className="space-y-1">
                      {data.releaseGroups.map((g) => (
                        <div key={g.name} className="flex items-center gap-2 text-xs">
                          <span className="flex-1 truncate" style={{ color: HPR.fg }}>{g.name}</span>
                          <span className="tabular-nums" style={{ color: HPR.fgMute }}>
                            {g.imports} import{g.imports === 1 ? '' : 's'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
