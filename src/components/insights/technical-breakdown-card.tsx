'use client';

import * as React from 'react';
import { HPR, mix } from '@/components/widgets/bento-primitives';
import { formatBytes } from '@/lib/format';
import { Panel, PanelLoading, PanelEmpty, Stat, useInsightsResource } from './insights-shared';
import type { MediaAnalysisDistEntry, MediaAnalysisResponse } from '@/types/insights';

// MediaLyze-style technical breakdown, sourced from the mediaInfo Sonarr/Radarr
// already extracted. Each panel is a single-variable distribution: one hue per
// panel (fixed, never cycled), labels/counts in text tokens, bar = share of files.

export type MediaAnalysisKindFilter = 'all' | 'movie' | 'episode';

export function kindQuery(kind: MediaAnalysisKindFilter): string {
  return kind === 'all' ? '' : `?kind=${kind}`;
}

const PANELS: { key: keyof MediaAnalysisResponse['distributions']; label: string; color: string }[] = [
  { key: 'videoCodec', label: 'Video codec', color: HPR.blue },
  { key: 'resolution', label: 'Resolution', color: HPR.purple },
  { key: 'dynamicRange', label: 'Dynamic range', color: HPR.amber },
  { key: 'audioCodec', label: 'Audio codec', color: HPR.cyan },
  { key: 'audioChannels', label: 'Audio channels', color: HPR.green },
  { key: 'videoBitDepth', label: 'Bit depth', color: HPR.pink },
];

function DistPanel({ label, color, entries, totalFiles }: {
  label: string;
  color: string;
  entries: MediaAnalysisDistEntry[];
  totalFiles: number;
}) {
  if (entries.length === 0) return null;
  return (
    <div className="flex flex-col gap-2">
      <span className="text-[10px] uppercase tracking-wide" style={{ color: HPR.fgMute }}>
        {label}
      </span>
      <div className="flex flex-col gap-1.5">
        {entries.map((e) => {
          const share = totalFiles > 0 ? e.count / totalFiles : 0;
          return (
            <div key={e.name} title={`${e.count.toLocaleString()} files · ${formatBytes(e.bytes)}`}>
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="truncate" style={{ color: HPR.fg }}>{e.name}</span>
                <span className="tabular-nums shrink-0" style={{ color: HPR.fgMute }}>
                  {e.count.toLocaleString()}
                </span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full" style={{ background: mix(HPR.fgMute, 15) }}>
                <div
                  className="h-1 rounded-full"
                  style={{ width: `${Math.max(share * 100, 1.5)}%`, background: color }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function fmtBitrate(bps: number): string {
  return `${(bps / 1_000_000).toFixed(1)} Mbps`;
}

export function TechnicalBreakdownCard({
  kind,
  onKindChange,
}: {
  kind: MediaAnalysisKindFilter;
  onKindChange: (kind: MediaAnalysisKindFilter) => void;
}) {
  const { data, loading } = useInsightsResource<MediaAnalysisResponse>(
    `/api/insights/media-analysis${kindQuery(kind)}`
  );

  const chips = (
    <div className="flex items-center gap-1">
      {(['all', 'movie', 'episode'] as const).map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onKindChange(id)}
          className={`px-2 py-0.5 rounded-full text-[10px] font-semibold transition-colors ${
            kind === id
              ? 'bg-primary/20 text-primary border border-primary/40'
              : 'bg-accent/40 text-muted-foreground border border-transparent hover:text-foreground'
          }`}
        >
          {id === 'all' ? 'All' : id === 'movie' ? 'Movies' : 'Episodes'}
        </button>
      ))}
    </div>
  );

  const hasData = !!data && data.totals.files > 0;

  return (
    <Panel title="Technical breakdown" right={chips}>
      {loading && !data ? (
        <PanelLoading height={260} />
      ) : !hasData ? (
        <PanelEmpty message="No media files with technical metadata found." height={260} />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-2 gap-x-4 gap-y-3 min-[480px]:grid-cols-4">
            <Stat label="Files" value={data.totals.files.toLocaleString()} />
            <Stat label="Total size" value={formatBytes(data.totals.bytes)} />
            <Stat
              label="Avg video bitrate"
              value={data.totals.avgVideoBitrate !== null ? fmtBitrate(data.totals.avgVideoBitrate) : '—'}
            />
            <Stat
              label="Movies / Episodes"
              value={`${data.totals.movies.toLocaleString()} / ${data.totals.episodes.toLocaleString()}`}
            />
          </div>

          <div className="h-px w-full" style={{ background: 'var(--hpr-hairline)' }} />

          <div className="grid grid-cols-1 gap-x-6 gap-y-4 min-[480px]:grid-cols-2 lg:grid-cols-3">
            {PANELS.map((p) => (
              <DistPanel
                key={p.key}
                label={p.label}
                color={p.color}
                entries={data.distributions[p.key]}
                totalFiles={data.totals.files}
              />
            ))}
          </div>

          {data.partial && (
            <p className="text-[10px]" style={{ color: HPR.fgSubtle }}>
              Some series couldn&apos;t be scanned this pass — episode counts may be incomplete.
            </p>
          )}
        </div>
      )}
    </Panel>
  );
}
