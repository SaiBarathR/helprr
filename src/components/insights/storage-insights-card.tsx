'use client';

import * as React from 'react';
import Link from 'next/link';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { formatBytes } from '@/lib/format';
import { Panel, PanelLoading, PanelEmpty, useInsightsResource } from './insights-shared';
import type { InsightsStorageResponse } from '@/types/insights';

const KIND_COLOR: Record<string, string> = {
  movie: HPR.blue,
  series: HPR.violet,
  artist: HPR.pink,
};

function Stat({ label, value, sub, color = HPR.fg }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span style={{ fontFamily: 'var(--hpr-font-display)', fontWeight: 600, fontSize: 18, color }}>
        {value}
      </span>
      <span className="text-[10px] uppercase tracking-wide" style={{ color: HPR.fgMute }}>
        {label}
        {sub ? <span className="normal-case"> · {sub}</span> : null}
      </span>
    </div>
  );
}

export function StorageInsightsCard() {
  const { data, loading } = useInsightsResource<InsightsStorageResponse>('/api/insights/storage');

  const maxSize = data?.topItems[0]?.sizeOnDisk ?? 0;
  const hasData =
    data && (data.totals.movies !== null || data.totals.series !== null || data.totals.music !== null);
  const libraryTotal = data
    ? (data.totals.movies ?? 0) + (data.totals.series ?? 0) + (data.totals.music ?? 0)
    : 0;
  const unmonitoredPct =
    data && libraryTotal > 0 ? Math.round((data.unmonitoredBytes / libraryTotal) * 100) : 0;

  return (
    <Panel title="Storage breakdown">
      {loading && !data ? (
        <PanelLoading height={220} />
      ) : !hasData ? (
        <PanelEmpty message="No library data available." height={220} />
      ) : (
        <div className="space-y-4">
          <div className="flex items-center gap-6 flex-wrap">
            <Stat label="Library total" value={formatBytes(libraryTotal)} />
            {data!.totals.movies !== null && (
              <Stat
                label="Movies"
                sub={`${data!.counts.movies ?? 0} items`}
                value={formatBytes(data!.totals.movies)}
                color={KIND_COLOR.movie}
              />
            )}
            {data!.totals.series !== null && (
              <Stat
                label="Series"
                sub={`${data!.counts.series ?? 0} shows`}
                value={formatBytes(data!.totals.series)}
                color={KIND_COLOR.series}
              />
            )}
            {data!.totals.music !== null && (
              <Stat
                label="Music"
                sub={`${data!.counts.music ?? 0} artists`}
                value={formatBytes(data!.totals.music)}
                color={KIND_COLOR.artist}
              />
            )}
            {data!.unmonitoredBytes > 0 && (
              <Stat
                label="In unmonitored items"
                sub={`${unmonitoredPct}% of library`}
                value={formatBytes(data!.unmonitoredBytes)}
                color={HPR.amber}
              />
            )}
          </div>

          {data!.topItems.length > 0 && (
            <div>
              <p className="text-[10px] uppercase tracking-wide mb-1.5" style={{ color: HPR.fgMute }}>
                Largest items
              </p>
              <div className="space-y-1.5">
                {data!.topItems.map((item) => {
                  const widthPct = maxSize > 0 ? Math.max(2, Math.round((item.sizeOnDisk / maxSize) * 100)) : 0;
                  const color = KIND_COLOR[item.kind] ?? HPR.blue;
                  const row = (
                    <div className="space-y-0.5">
                      <div className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="truncate" style={{ color: HPR.fg }}>
                          {item.title}
                          {item.year ? <span style={{ color: HPR.fgSubtle }}> · {item.year}</span> : null}
                        </span>
                        <span className="shrink-0 tabular-nums" style={{ color: HPR.fgMute }}>
                          {formatBytes(item.sizeOnDisk)}
                        </span>
                      </div>
                      <div className="h-1 rounded-full overflow-hidden" style={{ background: mix(color, 12) }}>
                        <div className="h-full rounded-full" style={{ width: `${widthPct}%`, background: color }} />
                      </div>
                    </div>
                  );
                  return item.href ? (
                    <Link key={`${item.kind}-${item.href}`} href={item.href} className="block hover:opacity-80 transition-opacity">
                      {row}
                    </Link>
                  ) : (
                    <div key={`${item.kind}-${item.title}`}>{row}</div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}
