'use client';
import { ApiError } from '@/lib/query-fetch';
import { ArrowDown, ArrowRight, ArrowUp } from 'lucide-react';

import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { DiskSpace, DiskTrend, ServicesStatsResponse, StorageTrendResponse } from '@/types/service-stats';
import { Bar, Eyebrow, FONT_MONO, HPR } from './bento-primitives';

async function fetchStorage(): Promise<DiskSpace[]> {
  const res = await fetch('/api/services/stats');
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data: ServicesStatsResponse = await res.json();
  return data.diskSpace || [];
}

async function fetchStorageTrend(): Promise<Record<string, DiskTrend>> {
  const res = await fetch('/api/storage/trend');
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data: StorageTrendResponse = await res.json();
  return data.trends || {};
}

function formatDaysUntilFull(days: number): string {
  if (days >= 365) return `~${Math.round(days / 365)}y to full`;
  if (days >= 1) return `~${Math.round(days)}d to full`;
  return 'full soon';
}

function TrendIndicator({ trend }: { trend: DiskTrend }) {
  const color =
    trend.direction === 'up' ? HPR.rose : trend.direction === 'down' ? HPR.green : HPR.fgSubtle;
  const Icon =
    trend.direction === 'up' ? ArrowUp : trend.direction === 'down' ? ArrowDown : ArrowRight;

  const weeklyBytes = Math.abs(trend.perDayBytes) * 7;
  let label: string;
  if (trend.direction === 'flat') {
    label = 'flat';
  } else if (trend.direction === 'up' && trend.daysUntilFull != null) {
    label = formatDaysUntilFull(trend.daysUntilFull);
  } else {
    label = `${trend.direction === 'up' ? '+' : '-'}${formatBytes(weeklyBytes)}/wk`;
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 3,
        fontFamily: FONT_MONO,
        fontSize: 10,
        color,
        whiteSpace: 'nowrap',
        flexShrink: 0,
      }}
      title="7-day usage trend"
    >
      <Icon size={11} strokeWidth={2.4} />
      {label}
    </span>
  );
}

export function StorageUsageWidget({ refreshInterval, narrow = false, editMode = false }: WidgetProps) {
  const { data: disks } = useWidgetData({
    fetchFn: fetchStorage,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'storage-usage',
  });
  const { data: trends } = useWidgetData({
    fetchFn: fetchStorageTrend,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'storage-trend',
  });
  const list = disks ?? [];
  const trendMap = trends ?? {};

  return (
    <div>
      <Eyebrow style={{ marginBottom: 10 }}>Storage Usage</Eyebrow>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        {list.length === 0 && (
          <div style={{ fontSize: 11, color: HPR.fgSubtle }}>No disk stats</div>
        )}
        {list.map((disk, i) => {
          const used = disk.totalSpace - disk.freeSpace;
          const pct = disk.totalSpace > 0 ? (used / disk.totalSpace) * 100 : 0;
          const color = pct > 90 ? HPR.rose : pct > 75 ? HPR.amber : HPR.fgMute;
          // Match the canonical diskId() identity (device label, path fallback)
          // without importing disk-space.ts (it pulls server-only clients).
          const trend = trendMap[disk.label || disk.path];
          return (
            <div key={i} style={{ minWidth: 0 }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: 4,
                  gap: 6,
                  flexWrap: 'wrap',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    gap: 6,
                    minWidth: 0,
                    flex: '1 1 auto',
                  }}
                >
               
                  {!narrow && disk.path && (
                    <span
                      style={{
                        fontFamily: FONT_MONO,
                        fontSize: 11,
                        color: HPR.fgSubtle,
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        flex: 1,
                      }}
                    >
                      {disk.path}
                    </span>
                  )}
                  {trend && <TrendIndicator trend={trend} />}
                </div>
                <span
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 10,
                    color: HPR.fgMute,
                    whiteSpace: 'nowrap',
                    flexShrink: 0,
                  }}
                >
                  {formatBytes(disk.freeSpace)} / {formatBytes(disk.totalSpace)}
                </span>
              </div>
              <Bar pct={pct} color={color} height={4} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
