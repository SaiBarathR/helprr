'use client';

import { Film, Tv, MonitorPlay } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { EditModePlaceholder } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface JellyfinStats {
  movieCount: number;
  seriesCount: number;
  episodeCount: number;
}

async function fetchJellyfinLibrary(): Promise<JellyfinStats | null> {
  const res = await fetch('/api/services/stats');
  if (!res.ok) return null;
  const data = await res.json();
  if (!data.jellyfin) return null;
  return {
    movieCount: data.jellyfin.movieCount || 0,
    seriesCount: data.jellyfin.seriesCount || 0,
    episodeCount: data.jellyfin.episodeCount || 0,
  };
}

export function JellyfinLibraryWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data, loading } = useWidgetData({ fetchFn: fetchJellyfinLibrary, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-3">
        <Skeleton className="h-5 w-20 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (!data) {
    return editMode ? <EditModePlaceholder title="Jellyfin Library" message="No library stats" /> : null;
  }

  if (size === 'small') {
    return (
      <div className="rounded-xl bg-card p-3">
        <div className="flex items-center gap-1.5 mb-1.5">
          <MonitorPlay className="h-3.5 w-3.5 text-[#00a4dc]" />
          <span className="text-xs text-muted-foreground">Jellyfin</span>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <Film className="h-3 w-3 text-blue-400" />
            <span className="text-sm font-bold tabular-nums">{data.movieCount}</span>
          </div>
          <div className="flex items-center gap-1">
            <Tv className="h-3 w-3 text-purple-400" />
            <span className="text-sm font-bold tabular-nums">{data.seriesCount}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4">
      <div className="flex items-center gap-2 mb-3">
        <MonitorPlay className="h-4 w-4 text-[#00a4dc]" />
        <span className="text-xs text-muted-foreground">Jellyfin Library</span>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <div className="text-center">
          <p className="text-xl font-bold tabular-nums">{data.movieCount}</p>
          <p className="text-[10px] text-muted-foreground">Movies</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold tabular-nums">{data.seriesCount}</p>
          <p className="text-[10px] text-muted-foreground">Series</p>
        </div>
        <div className="text-center">
          <p className="text-xl font-bold tabular-nums">{data.episodeCount}</p>
          <p className="text-[10px] text-muted-foreground">Episodes</p>
        </div>
      </div>
    </div>
  );
}
