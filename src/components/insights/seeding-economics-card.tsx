'use client';

import * as React from 'react';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { formatBytes } from '@/lib/format';
import { Panel, PanelLoading, PanelEmpty, Stat, useInsightsResource } from './insights-shared';
import type { InsightsTorrentsResponse } from '@/types/insights';

// One "Top uploads" row: torrent name + uploaded/ratio + a proportional bar.
// Shared with the seeding-economics dashboard widget.
export function SeedingUploadRow({
  t,
  maxUpload,
}: {
  t: InsightsTorrentsResponse['topUploaded'][number];
  maxUpload: number;
}) {
  const widthPct = maxUpload > 0 ? Math.max(2, Math.round((t.uploaded / maxUpload) * 100)) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="truncate" style={{ color: HPR.fg }}>{t.name}</span>
        <span className="shrink-0 tabular-nums" style={{ color: HPR.fgMute }}>
          {formatBytes(t.uploaded)} · {Number.isFinite(t.ratio) ? `${t.ratio.toFixed(2)}x` : '—'}
        </span>
      </div>
      <div className="h-1 rounded-full overflow-hidden" style={{ background: mix(HPR.green, 12) }}>
        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: HPR.green }} />
      </div>
    </div>
  );
}

export function SeedingEconomicsCard() {
  const { data, loading } = useInsightsResource<InsightsTorrentsResponse>('/api/insights/torrents');

  const maxUpload = data?.topUploaded[0]?.uploaded ?? 0;

  return (
    <Panel title="Seeding economics">
      {loading && !data ? (
        <PanelLoading height={200} />
      ) : !data || data.count === 0 ? (
        <PanelEmpty message="No torrents in qBittorrent." height={200} />
      ) : (
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
      )}
    </Panel>
  );
}
