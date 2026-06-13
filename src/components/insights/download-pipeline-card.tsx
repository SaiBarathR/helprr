'use client';

import * as React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
} from 'recharts';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { ChartTooltip } from '@/components/widgets/prowlarr-stats-shared';
import { Panel, PanelLoading, PanelEmpty, Stat, useInsightsResource, type InsightsRange } from './insights-shared';
import type { InsightsPipelineResponse } from '@/types/insights';

/** Minutes → compact human wait ("42m", "3.2h", "1.4d"). */
function fmtWait(mins: number): string {
  if (mins < 60) return `${mins}m`;
  if (mins < 60 * 24) return `${(mins / 60).toFixed(1)}h`;
  return `${(mins / (60 * 24)).toFixed(1)}d`;
}

export function DownloadPipelineCard({ range }: { range: InsightsRange }) {
  const { data, loading } = useInsightsResource<InsightsPipelineResponse>(
    `/api/insights/pipeline?from=${range.from}&to=${range.to}`
  );

  const hourData = React.useMemo(
    () => (data ? data.hours.map((count, hour) => ({ hour: `${String(hour).padStart(2, '0')}`, Activity: count })) : []),
    [data]
  );

  const hasData =
    data && (data.hours.some((h) => h > 0) || data.indexers.length > 0 || data.latency !== null);

  return (
    <Panel title="Pipeline intelligence">
      {loading && !data ? (
        <PanelLoading height={240} />
      ) : !hasData ? (
        <PanelEmpty message="No download activity in this range." height={240} />
      ) : (
        <div className="space-y-4">
          {/* Grab→import wait */}
          {data!.latency && (
            <div className="flex items-center gap-6 flex-wrap">
              <Stat label="Median grab→import" value={fmtWait(data!.latency.medianMins)} color={HPR.green} />
              <Stat label="Slowest 10% take over" value={fmtWait(data!.latency.p90Mins)} color={HPR.amber} />
              <Stat label="Completed downloads" value={String(data!.latency.samples)} />
            </div>
          )}

          {/* Activity by hour of day */}
          <div>
            <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
              Activity by hour of day
            </p>
            <div style={{ height: 120 }}>
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={hourData} margin={{ top: 2, right: 4, left: -22, bottom: 0 }}>
                  <XAxis
                    dataKey="hour"
                    interval={3}
                    tick={{ fontSize: 9, fill: HPR.fgSubtle }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <YAxis
                    allowDecimals={false}
                    tick={{ fontSize: 9, fill: HPR.fgSubtle }}
                    axisLine={false}
                    tickLine={false}
                  />
                  <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: mix(HPR.blue, 10) }} />
                  <Bar dataKey="Activity" fill={HPR.blue} radius={[2, 2, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          </div>

          {/* Indexer reliability + release groups */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {data!.indexers.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                  Indexer reliability
                </p>
                <div className="space-y-1">
                  {data!.indexers.map((ix) => (
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
            {data!.releaseGroups.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                  Top release groups
                </p>
                <div className="space-y-1">
                  {data!.releaseGroups.map((g) => (
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
        </div>
      )}
    </Panel>
  );
}
