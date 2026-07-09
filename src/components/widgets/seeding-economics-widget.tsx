'use client';

import { ApiError } from '@/lib/query-fetch';
import type { WidgetProps } from '@/lib/widgets/types';
import type { InsightsTorrentsResponse } from '@/types/insights';
import { formatBytes } from '@/lib/format';
import { HPR } from './bento-primitives';
import { InsightsWidgetFrame } from './insights-widget-frame';
import { Stat } from '@/components/insights/insights-shared';
import { SeedingUploadRow } from '@/components/insights/seeding-economics-card';

const EMPTY: InsightsTorrentsResponse = {
  count: 0,
  seeding: 0,
  totalUploaded: 0,
  totalDownloaded: 0,
  overallRatio: null,
  belowRatio1: 0,
  topUploaded: [],
};

async function fetchTorrents(): Promise<InsightsTorrentsResponse> {
  const res = await fetch('/api/insights/torrents');
  // 403 = missing insights.view at the data layer → empty state, not the error boundary.
  if (res.status === 403) return EMPTY;
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  return res.json();
}

export function SeedingEconomicsWidget({ refreshInterval, editMode = false }: WidgetProps) {
  return (
    <InsightsWidgetFrame<InsightsTorrentsResponse>
      title="Seeding Economics"
      refreshInterval={refreshInterval}
      editMode={editMode}
      fetchFn={fetchTorrents}
      cacheKey="insights-torrents"
      isEmpty={(d) => !d || d.count === 0}
      emptyMessage="No torrents in qBittorrent."
    >
      {(data) => {
        const maxUpload = data.topUploaded[0]?.uploaded ?? 0;
        return (
          <div className="space-y-4">
            <div className="flex items-center gap-6 flex-wrap">
              <Stat label="Total uploaded" value={formatBytes(data.totalUploaded)} color={HPR.green} />
              <Stat
                label="Overall ratio"
                value={data.overallRatio !== null ? data.overallRatio.toFixed(2) : '—'}
                color={data.overallRatio !== null && data.overallRatio >= 1 ? HPR.green : HPR.amber}
              />
              <Stat label="Seeding" value={`${data.seeding}/${data.count}`} />
              {data.belowRatio1 > 0 && (
                <Stat label="Completed below 1.0" value={String(data.belowRatio1)} color={HPR.amber} />
              )}
            </div>

            {data.topUploaded.length > 0 && (
              <div>
                <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                  Top uploads
                </p>
                <div className="space-y-1.5">
                  {data.topUploaded.map((t) => (
                    <SeedingUploadRow key={t.name} t={t} maxUpload={maxUpload} />
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
