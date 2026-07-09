'use client';

import { ApiError } from '@/lib/query-fetch';
import type { WidgetProps } from '@/lib/widgets/types';
import type { InsightsStorageResponse } from '@/types/insights';
import { formatBytes } from '@/lib/format';
import { HPR } from './bento-primitives';
import { InsightsWidgetFrame } from './insights-widget-frame';
import { Stat } from '@/components/insights/insights-shared';
import { StorageItemRow, KIND_COLOR } from '@/components/insights/storage-insights-card';

async function fetchStorage(): Promise<InsightsStorageResponse> {
  const res = await fetch('/api/insights/storage');
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

export function StorageBreakdownWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <InsightsWidgetFrame<InsightsStorageResponse>
      title="Storage Breakdown"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchStorage}
      cacheKey="insights-storage"
      isEmpty={(d) => !d || (d.totals.movies === null && d.totals.series === null && d.totals.music === null)}
      emptyMessage="No library data available."
    >
      {(data) => {
        const libraryTotal = (data.totals.movies ?? 0) + (data.totals.series ?? 0) + (data.totals.music ?? 0);
        const maxSize = data.topItems[0]?.sizeOnDisk ?? 0;
        const unmonitoredPct = libraryTotal > 0 ? Math.round((data.unmonitoredBytes / libraryTotal) * 100) : 0;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-6 flex-wrap">
              <Stat label="Library total" value={formatBytes(libraryTotal)} />
              {data.totals.movies !== null && (
                <Stat
                  label="Movies"
                  sub={`${data.counts.movies ?? 0} items`}
                  value={formatBytes(data.totals.movies)}
                  color={KIND_COLOR.movie}
                />
              )}
              {data.totals.series !== null && (
                <Stat
                  label="Series"
                  sub={`${data.counts.series ?? 0} shows`}
                  value={formatBytes(data.totals.series)}
                  color={KIND_COLOR.series}
                />
              )}
              {data.totals.music !== null && (
                <Stat
                  label="Music"
                  sub={`${data.counts.music ?? 0} artists`}
                  value={formatBytes(data.totals.music)}
                  color={KIND_COLOR.artist}
                />
              )}
              {data.unmonitoredBytes > 0 && (
                <Stat
                  label="In unmonitored items"
                  sub={`${unmonitoredPct}% of library`}
                  value={formatBytes(data.unmonitoredBytes)}
                  color={HPR.amber}
                />
              )}
            </div>

            {data.topItems.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                  Largest items
                </p>
                <div className="space-y-1.5">
                  {data.topItems.map((item) => (
                    <StorageItemRow key={`${item.kind}-${item.href ?? item.title}`} item={item} maxSize={maxSize} />
                  ))}
                </div>
              </div>
            )}
          </div>
        );
      }}
    </InsightsWidgetFrame>
  );
}
