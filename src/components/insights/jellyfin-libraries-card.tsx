'use client';

import * as React from 'react';
import { Film, Tv, Disc3, Layers, Video, Library, type LucideIcon } from 'lucide-react';
import { HPR, Pill, mix } from '@/components/widgets/bento-primitives';
import { Panel, PanelLoading, PanelEmpty, useInsightsResource } from './insights-shared';
import type { JellyfinLibrariesResponse, JellyfinLibrarySummary } from '@/types/jellyfin';

const TYPE_META: Record<string, { icon: LucideIcon; color: string }> = {
  movies: { icon: Film, color: HPR.blue },
  tvshows: { icon: Tv, color: HPR.purple },
  music: { icon: Disc3, color: HPR.pink },
  boxsets: { icon: Layers, color: HPR.amber },
  homevideos: { icon: Video, color: HPR.cyan },
  mixed: { icon: Library, color: HPR.violet },
};

function metaFor(type: string) {
  return TYPE_META[type] ?? TYPE_META.mixed;
}

// Derived data point: average episodes per series for a TV library.
function avgEpisodesPerSeries(lib: JellyfinLibrarySummary): string | null {
  if (lib.type !== 'tvshows') return null;
  const series = lib.metrics.find((m) => m.label === 'Series')?.value ?? 0;
  const episodes = lib.metrics.find((m) => m.label === 'Episodes')?.value ?? 0;
  if (series <= 0 || episodes <= 0) return null;
  return `~${(episodes / series).toFixed(1)} eps/series`;
}

function LibraryRow({ lib, max, total }: { lib: JellyfinLibrarySummary; max: number; total: number }) {
  const { icon: Icon, color } = metaFor(lib.type);
  const barPct = max > 0 ? (lib.itemCount / max) * 100 : 0;
  const sharePct = total > 0 ? Math.round((lib.itemCount / total) * 100) : 0;
  const avg = avgEpisodesPerSeries(lib);
  const breakdown = lib.metrics.map((m) => `${m.value.toLocaleString()} ${m.label.toLowerCase()}`).join(' · ');

  return (
    <div className="relative flex items-center gap-3 px-2 py-2.5">
      <div className="absolute inset-y-0 left-0 rounded-md" style={{ width: `${barPct}%`, background: mix(color, 7) }} />
      <div
        className="relative shrink-0 flex items-center justify-center rounded-lg"
        style={{ width: 32, height: 32, background: mix(color, 14), color }}
      >
        <Icon size={16} />
      </div>
      <div className="relative min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium truncate" style={{ color: HPR.fg }}>
            {lib.name}
          </span>
          {!lib.enabled && (
            <span className="text-[9px] uppercase tracking-wide shrink-0" style={{ color: HPR.fgSubtle }}>
              disabled
            </span>
          )}
          {avg && <Pill color={color} style={{ fontSize: 9 }}>{avg}</Pill>}
        </div>
        <div className="text-[11px] truncate" style={{ color: HPR.fgMute }}>
          {breakdown || '—'}
        </div>
        {lib.paths[0] && (
          <div className="text-[10px] truncate" style={{ color: HPR.fgSubtle, fontFamily: 'var(--hpr-font-mono)' }}>
            {lib.paths.join(', ')}
          </div>
        )}
      </div>
      <div className="relative shrink-0 text-right">
        <div className="text-sm font-semibold tabular-nums" style={{ color: HPR.fg }}>
          {lib.itemCount.toLocaleString()}
        </div>
        <div className="text-[10px]" style={{ color: HPR.fgSubtle }}>
          {sharePct}% of items
        </div>
      </div>
    </div>
  );
}

export function JellyfinLibrariesCard() {
  const { data, loading } = useInsightsResource<JellyfinLibrariesResponse>('/api/insights/jellyfin-libraries');
  const libraries = data?.libraries ?? [];
  const max = libraries.reduce((m, lib) => Math.max(m, lib.itemCount), 0);

  return (
    <Panel
      title="Jellyfin libraries"
      right={
        data && libraries.length > 0 ? (
          <span style={{ fontFamily: 'var(--hpr-font-mono)' }}>
            {libraries.length} libs · {data.totalItems.toLocaleString()} items
          </span>
        ) : undefined
      }
    >
      {loading && !data ? (
        <PanelLoading height={160} />
      ) : libraries.length === 0 ? (
        <PanelEmpty message="No Jellyfin libraries found." height={120} />
      ) : (
        <div className="divide-y divide-border/50">
          {libraries.map((lib) => (
            <LibraryRow key={lib.id} lib={lib} max={max} total={data!.totalItems} />
          ))}
        </div>
      )}
    </Panel>
  );
}
