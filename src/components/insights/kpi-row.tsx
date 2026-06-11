'use client';

import * as React from 'react';
import { Film, Tv, Disc3, Clapperboard, Download, MonitorPlay } from 'lucide-react';
import { StatTile, HPR } from '@/components/widgets/bento-primitives';
import { PanelLoading } from './insights-shared';
import type { ServicesStatsResponse } from '@/types/service-stats';

interface Tile {
  key: string;
  icon: React.ReactNode;
  label: string;
  value: React.ReactNode;
  tone: string;
}

export function KpiRow({ stats, loading }: { stats: ServicesStatsResponse | null; loading: boolean }) {
  if (loading && !stats) {
    return (
      <div className="rounded-xl bg-card border p-4">
        <PanelLoading height={96} />
      </div>
    );
  }
  if (!stats) return null;

  const tiles: Tile[] = [];
  const push = (t: Tile | false) => {
    if (t) tiles.push(t);
  };

  push(
    stats.totalMovies != null && {
      key: 'movies',
      icon: <Film size={15} />,
      label: 'Movies',
      value: stats.totalMovies.toLocaleString(),
      tone: HPR.blue,
    }
  );
  push(
    stats.totalSeries != null && {
      key: 'series',
      icon: <Tv size={15} />,
      label: 'Series',
      value: stats.totalSeries.toLocaleString(),
      tone: HPR.purple,
    }
  );
  push(
    stats.totalArtists != null && {
      key: 'artists',
      icon: <Disc3 size={15} />,
      label: 'Artists',
      value: stats.totalArtists.toLocaleString(),
      tone: HPR.pink,
    }
  );
  push(
    stats.jellyfin != null && {
      key: 'episodes',
      icon: <Clapperboard size={15} />,
      label: 'Episodes',
      value: stats.jellyfin.episodeCount.toLocaleString(),
      tone: HPR.violet,
    }
  );
  push(
    stats.activeDownloads != null && {
      key: 'downloads',
      icon: <Download size={15} />,
      label: 'Downloading',
      value: stats.activeDownloads.toLocaleString(),
      tone: HPR.amber,
    }
  );
  push(
    stats.jellyfin != null && {
      key: 'streams',
      icon: <MonitorPlay size={15} />,
      label: 'Live Streams',
      value: stats.jellyfin.activeStreams.toLocaleString(),
      tone: HPR.green,
    }
  );

  if (tiles.length === 0) return null;

  return (
    <div className="grid gap-3 grid-cols-2 sm:grid-cols-3 lg:grid-cols-4">
      {tiles.map((t) => (
        <div key={t.key} className="rounded-xl bg-card border p-4">
          <StatTile icon={t.icon} label={t.label} value={t.value} tone={t.tone} />
        </div>
      ))}
    </div>
  );
}
