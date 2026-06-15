'use client';
import { ApiError } from '@/lib/query-fetch';

import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { DiskSpace, ServicesStatsResponse } from '@/types/service-stats';
import { Bar, Eyebrow, FONT_MONO, HPR } from './bento-primitives';

async function fetchStorage(): Promise<DiskSpace[]> {
  const res = await fetch('/api/services/stats');
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  const data: ServicesStatsResponse = await res.json();
  return data.diskSpace || [];
}

export function StorageUsageWidget({ refreshInterval, narrow = false, editMode = false }: WidgetProps) {
  const { data: disks } = useWidgetData({
    fetchFn: fetchStorage,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'storage-usage',
  });
  const list = disks ?? [];

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
