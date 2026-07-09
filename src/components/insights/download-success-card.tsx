'use client';

import * as React from 'react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { HPR } from '@/components/widgets/bento-primitives';
import { ChartTooltip, fmtNum } from '@/components/widgets/prowlarr-stats-shared';
import { Panel, PanelLoading, PanelEmpty, SuccessRing, useInsightsResource, shortDate, type InsightsRange } from './insights-shared';
import type { InsightsDownloadsResponse } from '@/types/insights';

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

// The stacked Imported/Failed bar chart, split out so the download-reliability
// dashboard widget can dynamic-import it. Fills its parent (caller sets height).
export function DownloadSuccessChart({ data }: { data: InsightsDownloadsResponse }) {
  const chartData = React.useMemo(
    () => data.perDay.map((d) => ({ date: shortDate(d.date), Imported: d.imported, Failed: d.failed })),
    [data]
  );
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
      <BarChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 2 }}>
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
          width={32}
          allowDecimals={false}
        />
        <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in oklab, var(--foreground) 4%, transparent)' }} />
        <Bar dataKey="Imported" stackId="dl" fill={HPR.green} />
        <Bar dataKey="Failed" stackId="dl" fill={HPR.rose} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function DownloadSuccessCard({ range }: { range: InsightsRange }) {
  const { data, loading } = useInsightsResource<InsightsDownloadsResponse>(
    `/api/insights/downloads?from=${range.from}&to=${range.to}`
  );

  const hasEvents = data && (data.totals.grabbed + data.totals.imported + data.totals.failed) > 0;
  const resolved = data ? data.totals.imported + data.totals.failed : 0;

  return (
    <Panel title="Download reliability">
      {loading && !data ? (
        <PanelLoading height={220} />
      ) : !hasEvents ? (
        <PanelEmpty message="No download history for this range." height={220} />
      ) : (
        <>
          <div className="flex items-center gap-5 mb-3 flex-wrap">
            {data!.successRate != null && <SuccessRing pct={data!.successRate} />}
            <div className="flex items-center gap-5">
              <Chip label="Grabbed" value={data!.totals.grabbed} color={HPR.amber} />
              <Chip label="Imported" value={data!.totals.imported} color={HPR.green} />
              <Chip label="Failed" value={data!.totals.failed} color={HPR.rose} />
            </div>
          </div>
          {resolved > 0 ? (
            <div style={{ height: 180 }}>
              <DownloadSuccessChart data={data!} />
            </div>
          ) : (
            <PanelEmpty message="Grabs found, but nothing imported or failed in this window yet." height={120} />
          )}
        </>
      )}
    </Panel>
  );
}
