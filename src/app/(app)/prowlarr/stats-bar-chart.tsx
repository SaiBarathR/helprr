'use client';

import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import { fmtNum, formatMs } from '@/components/widgets/prowlarr-stats-shared';

// Recharts lives only in this module so the Stats tab's charts can be
// code-split out of the prowlarr page bundle and loaded on demand (see the
// dynamic() import in page.tsx).

export const BAR_H = 34;
const Y_WIDTH = 108;
const CHART_MARGIN = { top: 2, right: 12, left: 0, bottom: 2 };

/* eslint-disable @typescript-eslint/no-explicit-any */
function ChartTooltipContent({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-background/95 backdrop-blur-sm px-3 py-2 text-xs shadow-xl">
      <p className="font-semibold mb-1.5 text-foreground truncate max-w-[200px]">{label}</p>
      {payload.map((entry: { name: string; value: number; color: string }, i: number) => (
        <div key={i} className="flex items-center gap-2">
          <span className="w-2 h-2 rounded-full shrink-0" style={{ background: entry.color }} />
          <span className="text-muted-foreground">{entry.name}:</span>
          <span className="font-medium text-foreground tabular-nums">
            {entry.name === 'Response' || entry.name === 'ms'
              ? formatMs(entry.value)
              : entry.name.includes('%')
                ? `${entry.value}%`
                : fmtNum(entry.value)}
          </span>
        </div>
      ))}
    </div>
  );
}

function YTick({ x, y, payload }: any) {
  const text = String(payload?.value ?? '');
  const maxLen = 16;
  const display = text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--hpr-fgMute)" fontSize={10}>
      {display}
    </text>
  );
}
/* eslint-enable @typescript-eslint/no-explicit-any */

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
        <RechartsTooltip content={<ChartTooltipContent />} cursor={{ fill: 'color-mix(in oklab, var(--foreground) 4%, transparent)' }} />
        {bars.map((b) => (
          <Bar key={b.dataKey} dataKey={b.dataKey} stackId={b.stackId} fill={b.fill} radius={b.radius} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
