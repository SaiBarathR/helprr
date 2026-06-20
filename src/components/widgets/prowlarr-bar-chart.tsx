'use client';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { Y_WIDTH, CHART_MARGIN, YTick, ChartTooltip, type ProwlarrChartBar } from './prowlarr-stats-shared';

// Recharts (~40KB) lives only in this module so it can be code-split out of the
// main dashboard bundle and loaded on demand (see the dynamic() import in
// prowlarr-stats-shared.tsx).
interface ProwlarrBarChartProps {
  rows: { name: string }[];
  bars: ProwlarrChartBar[];
  xTickFormatter: (value: number) => string;
}

export default function ProwlarrBarChart({ rows, bars, xTickFormatter }: ProwlarrBarChartProps) {
  return (
    <ResponsiveContainer width="100%" height="100%" initialDimension={{ width: 1, height: 1 }}>
      <BarChart data={rows} layout="vertical" margin={CHART_MARGIN}>
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
        {bars.map((b, i) => (
          <Bar
            key={b.dataKey}
            dataKey={b.dataKey}
            stackId={b.stackId}
            fill={b.color}
            radius={b.radius ?? (i === bars.length - 1 ? [0, 4, 4, 0] : undefined)}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
