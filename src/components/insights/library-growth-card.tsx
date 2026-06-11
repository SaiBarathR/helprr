'use client';

import * as React from 'react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { HPR } from '@/components/widgets/bento-primitives';
import { ChartTooltip, fmtNum } from '@/components/widgets/prowlarr-stats-shared';
import { Panel, PanelLoading, PanelEmpty, useInsightsResource, shortDate, type InsightsRange } from './insights-shared';
import type { InsightsLibraryResponse } from '@/types/insights';

const SERIES = [
  { key: 'Movies', field: 'movies' as const, color: HPR.blue },
  { key: 'Series', field: 'series' as const, color: HPR.purple },
  { key: 'Music', field: 'music' as const, color: HPR.pink },
];

export function LibraryGrowthCard({ range }: { range: InsightsRange }) {
  const { data, loading } = useInsightsResource<InsightsLibraryResponse>(
    `/api/insights/library?from=${range.from}&to=${range.to}`
  );

  const active = React.useMemo(() => SERIES.filter((s) => data?.series[s.field] != null), [data]);

  const chartData = React.useMemo(() => {
    if (!data) return [];
    return data.days.map((day, i) => {
      const row: Record<string, number | string> = { date: shortDate(day) };
      for (const s of active) row[s.key] = data.series[s.field]![i] ?? 0;
      return row;
    });
  }, [data, active]);

  const total = data?.totals.total;

  return (
    <Panel
      title="Library growth"
      right={total != null ? <span style={{ fontFamily: 'var(--hpr-font-mono)' }}>{total.toLocaleString()} titles</span> : undefined}
    >
      {loading && !data ? (
        <PanelLoading height={240} />
      ) : !data || active.length === 0 || chartData.length === 0 ? (
        <PanelEmpty message="No library data for this range." height={240} />
      ) : (
        <>
          <div className="flex items-center gap-3 mb-2 flex-wrap">
            {active.map((s) => (
              <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px]" style={{ color: HPR.fgMute }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                {s.key}
                {data.totals[s.field] != null && (
                  <span style={{ fontFamily: 'var(--hpr-font-mono)' }}> {data.totals[s.field]!.toLocaleString()}</span>
                )}
              </span>
            ))}
          </div>
          <div style={{ height: 240 }}>
            <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
              <AreaChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
                <defs>
                  {active.map((s) => (
                    <linearGradient key={s.key} id={`lg-${s.field}`} x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor={s.color} stopOpacity={0.35} />
                      <stop offset="100%" stopColor={s.color} stopOpacity={0.02} />
                    </linearGradient>
                  ))}
                </defs>
                <CartesianGrid stroke="var(--hpr-hairline)" vertical={false} />
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: 'var(--hpr-fgMute)' }}
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: 'var(--hpr-fgMute)' }}
                  tickFormatter={fmtNum}
                  axisLine={false}
                  tickLine={false}
                  width={36}
                  allowDecimals={false}
                />
                <RechartsTooltip content={<ChartTooltip />} />
                {active.map((s) => (
                  <Area
                    key={s.key}
                    type="monotone"
                    dataKey={s.key}
                    stackId="lib"
                    stroke={s.color}
                    strokeWidth={1.5}
                    fill={`url(#lg-${s.field})`}
                  />
                ))}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </>
      )}
    </Panel>
  );
}
