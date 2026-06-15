'use client';
import { ApiError } from '@/lib/query-fetch';

import * as React from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as RechartsTooltip, ResponsiveContainer } from 'recharts';
import type { ProwlarrStats } from '@/lib/prowlarr-client';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useWidgetFilter } from './use-widget-filter';
import { daysToStartDate, DaysPill, PROWLARR_DAYS_OPTIONS } from './widget-filter-controls';
import { SectionHeader, HPR } from './bento-primitives';

export const Y_WIDTH = 96;
export const CHART_MARGIN = { top: 2, right: 12, left: 0, bottom: 2 } as const;

export async function fetchProwlarrStats(days: number): Promise<ProwlarrStats | null> {
  const startDate = daysToStartDate(days);
  const url = startDate
    ? `/api/prowlarr/stats?startDate=${encodeURIComponent(startDate)}`
    : '/api/prowlarr/stats';
  const res = await fetch(url);
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data = await res.json();
  if (data?.error) return null;
  return data as ProwlarrStats;
}

export function fmtNum(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(n);
}

export function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

interface YTickProps {
  x?: number;
  y?: number;
  payload?: { value: string | number };
}

export function YTick({ x, y, payload }: YTickProps) {
  const text = String(payload?.value ?? '');
  const maxLen = 14;
  const display = text.length > maxLen ? text.slice(0, maxLen - 1) + '…' : text;
  return (
    <text x={x} y={y} dy={4} textAnchor="end" fill="var(--hpr-fgMute)" fontSize={10}>
      {display}
    </text>
  );
}

interface ChartTooltipPayloadEntry {
  name: string;
  value: number;
  color: string;
}

interface ChartTooltipProps {
  active?: boolean;
  payload?: ChartTooltipPayloadEntry[];
  label?: string;
}

export function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div
      style={{
        background: HPR.surface,
        border: `1px solid ${HPR.hairline2}`,
        borderRadius: 8,
        padding: '6px 8px',
        fontSize: 11,
        color: HPR.fg,
        boxShadow: '0 6px 16px color-mix(in oklab, var(--hpr-ink) 50%, transparent)',
      }}
    >
      <p style={{ fontWeight: 600, marginBottom: 4, maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </p>
      {payload.map((entry, i) => (
        <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: entry.color, flexShrink: 0 }} />
          <span style={{ color: HPR.fgMute }}>{entry.name}:</span>
          <span style={{ fontFamily: 'var(--hpr-font-mono)', fontWeight: 500 }}>
            {entry.name === 'Response'
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

export function EmptyChartState({ message }: { message: string }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1,
        minHeight: 60,
        fontSize: 11,
        color: HPR.fgSubtle,
      }}
    >
      {message}
    </div>
  );
}

export interface ProwlarrChartBar {
  dataKey: string;
  color: string;
  stackId?: string;
  radius?: [number, number, number, number];
}

interface ProwlarrChartWidgetShellProps<Row extends { name: string }> {
  widgetId: string;
  title: string;
  selectData: (stats: ProwlarrStats) => Row[];
  bars: ProwlarrChartBar[];
  xTickFormatter?: (value: number) => string;
  emptyMessage?: string;
  legend?: { color: string; label: string }[];
  editMode?: boolean;
  narrow?: boolean;
  refreshInterval: number;
}

export function ProwlarrChartWidgetShell<Row extends { name: string }>(
  props: ProwlarrChartWidgetShellProps<Row>,
) {
  const {
    widgetId,
    title,
    selectData,
    bars,
    xTickFormatter = fmtNum,
    emptyMessage = 'No data for this period.',
    legend,
    editMode = false,
    narrow = false,
    refreshInterval,
  } = props;

  const [filters, setFilters] = useWidgetFilter<{ days: number }>(widgetId, { days: 30 });

  const fetchFn = React.useCallback(() => fetchProwlarrStats(filters.days), [filters.days]);
  const { data, loading } = useWidgetData<ProwlarrStats | null>({
    fetchFn,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `prowlarr-stats-${filters.days}d`,
  });

  const rows = data ? selectData(data) : [];

  const badge = (
    <DaysPill
      value={filters.days}
      options={PROWLARR_DAYS_OPTIONS}
      onChange={(days) => setFilters({ days })}
      disabled={editMode}
      narrow={narrow}
    />
  );

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <SectionHeader
        title={title}
        badge={badge}
        right={
          legend && legend.length > 0 ? (
            <div style={{ display: 'flex', gap: 8 }}>
              {legend.map(({ color, label }) => (
                <span
                  key={label}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: HPR.fgMute }}
                >
                  <span style={{ width: 7, height: 7, borderRadius: 2, background: color, flexShrink: 0 }} />
                  {label}
                </span>
              ))}
            </div>
          ) : undefined
        }
      />
      {loading && rows.length === 0 ? (
        <EmptyChartState message="Loading…" />
      ) : rows.length === 0 ? (
        <EmptyChartState message={emptyMessage} />
      ) : (
        <div style={{ flex: 1, minHeight: 0, overflow: 'hidden' }}>
          <ResponsiveContainer
            width="100%"
            height="100%"
            initialDimension={{ width: 1, height: 1 }}
          >
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
        </div>
      )}
    </div>
  );
}
