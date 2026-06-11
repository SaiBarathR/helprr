'use client';

import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { HPR } from '@/components/widgets/bento-primitives';
import {
  ChartTooltip,
  YTick,
  fmtNum,
  CHART_MARGIN,
  Y_WIDTH,
} from '@/components/widgets/prowlarr-stats-shared';
import { Panel, PanelLoading, PanelEmpty, useInsightsResource, type InsightsRange } from './insights-shared';
import type { ProwlarrStats } from '@/lib/prowlarr-client';

const TOP_N = 8;

export function TopIndexersCard({ range }: { range: InsightsRange }) {
  // Prowlarr's indexerstats accepts only startDate; the range's `from` drives it.
  const startDate = `${range.from}T00:00:00.000Z`;
  const { data, loading } = useInsightsResource<ProwlarrStats>(
    `/api/prowlarr/stats?startDate=${encodeURIComponent(startDate)}`
  );

  const rows = React.useMemo(() => {
    if (!data?.indexers) return [];
    return [...data.indexers]
      .filter((i) => i.numberOfGrabs > 0 || i.numberOfQueries > 0)
      .sort((a, b) => b.numberOfGrabs - a.numberOfGrabs)
      .slice(0, TOP_N)
      .map((i) => ({ name: i.indexerName, Grabs: i.numberOfGrabs, Queries: i.numberOfQueries }));
  }, [data]);

  const totalGrabs = rows.reduce((s, r) => s + r.Grabs, 0);

  return (
    <Panel
      title="Top indexers"
      right={data ? <span style={{ fontFamily: 'var(--hpr-font-mono)' }}>{fmtNum(totalGrabs)} grabs</span> : undefined}
    >
      {loading && !data ? (
        <PanelLoading height={240} />
      ) : rows.length === 0 ? (
        <PanelEmpty message="No Prowlarr indexer activity for this range." height={240} />
      ) : (
        <div style={{ height: Math.max(180, rows.length * 30) }}>
          <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
            <BarChart data={rows} layout="vertical" margin={CHART_MARGIN}>
              <XAxis
                type="number"
                tick={{ fontSize: 10, fill: 'var(--hpr-fgMute)' }}
                tickFormatter={fmtNum}
                axisLine={false}
                tickLine={false}
              />
              <YAxis type="category" dataKey="name" width={Y_WIDTH} tick={<YTick />} axisLine={false} tickLine={false} />
              <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in oklab, var(--foreground) 4%, transparent)' }} />
              <Bar dataKey="Grabs" fill={HPR.amber} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </Panel>
  );
}
