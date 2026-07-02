'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { ChartTooltip, YTick, Y_WIDTH, CHART_MARGIN } from '@/components/widgets/prowlarr-stats-shared';

// Recharts lives only in this module so the Stats tab's charts can be
// code-split out of the prowlarr page bundle and loaded on demand (see the
// dynamic() import in page.tsx). Sizing/tooltip/tick helpers come from the
// shared Prowlarr stats module so these charts stay aligned with the widget
// and insights charts.

const BAR_H = 34;

export interface StatsChartBar {
  dataKey: string;
  fill: string;
  stackId?: string;
  radius?: [number, number, number, number];
}

interface StatsBarChartProps {
  data: Array<{ name: string } & Record<string, unknown>>;
  minHeight: number;
  xTickFormatter: (value: number) => string;
  bars: StatsChartBar[];
}

export default function StatsBarChart({ data, minHeight, xTickFormatter, bars }: StatsBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height={Math.max(minHeight, data.length * BAR_H)}>
      <BarChart data={data} layout="vertical" margin={CHART_MARGIN} barSize={12}>
        <XAxis
          type="number"
          tick={{ fontSize: 10, fill: 'var(--hpr-fgMute)' }}
          tickFormatter={xTickFormatter}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="name"
          width={Y_WIDTH}
          tick={<YTick />}
          axisLine={false}
          tickLine={false}
        />
        <RechartsTooltip content={<ChartTooltip />} cursor={{ fill: 'color-mix(in oklab, var(--foreground) 4%, transparent)' }} />
        {bars.map((b) => (
          <Bar key={b.dataKey} dataKey={b.dataKey} stackId={b.stackId} fill={b.fill} radius={b.radius} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
