'use client';

import type { ReactNode } from 'react';
import Link from 'next/link';
import { Film, Tv, Download, HardDrive } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { ServicesStatsResponse } from '@/types/service-stats';

function StatsCard({
  href,
  editMode,
  className,
  children,
}: {
  href?: string;
  editMode: boolean;
  className: string;
  children: ReactNode;
}) {
  if (!href || editMode) {
    return <div className={className}>{children}</div>;
  }

  return (
    <Link href={href} className={`${className} transition-colors hover:bg-muted/30 active:bg-muted/40`}>
      {children}
    </Link>
  );
}

async function fetchStats(): Promise<ServicesStatsResponse> {
  const res = await fetch('/api/services/stats');
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

export function StatsGridWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data: stats, loading } = useWidgetData({ fetchFn: fetchStats, refreshInterval });

  if (loading) {
    return (
      <div className="grid gap-3 grid-cols-2">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl bg-card p-4">
            <Skeleton className="h-8 w-20 mb-2" />
            <Skeleton className="h-4 w-24" />
          </div>
        ))}
      </div>
    );
  }

  if (size === 'small') {
    return (
      <div className="rounded-xl bg-card p-2 grid grid-cols-3 gap-2">
        <StatsCard href="/movies" editMode={editMode} className="rounded-lg p-2 flex items-center gap-2 min-w-0">
          <Film className="h-4 w-4 text-blue-500" />
          <span className="text-lg font-bold tabular-nums">{stats?.totalMovies ?? '--'}</span>
        </StatsCard>
        <StatsCard href="/series" editMode={editMode} className="rounded-lg p-2 flex items-center gap-2 min-w-0">
          <Tv className="h-4 w-4 text-purple-500" />
          <span className="text-lg font-bold tabular-nums">{stats?.totalSeries ?? '--'}</span>
        </StatsCard>
        <StatsCard href="/activity" editMode={editMode} className="rounded-lg p-2 flex items-center gap-2 min-w-0">
          <Download className="h-4 w-4 text-green-500" />
          <span className="text-lg font-bold tabular-nums">{stats?.activeDownloads ?? '--'}</span>
        </StatsCard>
      </div>
    );
  }

  return (
    <div className="grid gap-3 grid-cols-2">
      <StatsCard href="/movies" editMode={editMode} className="rounded-xl bg-card p-4 flex items-center gap-3">
        <div className="rounded-lg bg-blue-500/10 p-2.5">
          <Film className="h-5 w-5 text-blue-500" />
        </div>
        <div>
          <p className="text-2xl font-bold">{stats?.totalMovies ?? '--'}</p>
          <p className="text-xs text-muted-foreground">Movies</p>
        </div>
      </StatsCard>
      <StatsCard href="/series" editMode={editMode} className="rounded-xl bg-card p-4 flex items-center gap-3">
        <div className="rounded-lg bg-purple-500/10 p-2.5">
          <Tv className="h-5 w-5 text-purple-500" />
        </div>
        <div>
          <div className='flex gap-2 items-center'>
            <p className="text-2xl font-bold">{stats?.totalSeries ?? '--'}</p>
            <p className="text-xl">TV</p>
          </div>
          {stats?.jellyfin?.episodeCount !== undefined && (
            <p className="text-xs text-muted-foreground">{stats.jellyfin.episodeCount} episodes</p>
          )}
        </div>
      </StatsCard>
      <StatsCard href="/activity" editMode={editMode} className="rounded-xl bg-card p-4 flex items-center gap-3">
        <div className="rounded-lg bg-green-500/10 p-2.5">
          <Download className="h-5 w-5 text-green-500" />
        </div>
        <div>
          <p className="text-2xl font-bold">{stats?.activeDownloads ?? '--'}</p>
          <p className="text-xs text-muted-foreground">Downloading</p>
        </div>
      </StatsCard>
      <StatsCard editMode={editMode} className="rounded-xl bg-card p-4 flex items-center gap-3">
        <div className="rounded-lg bg-orange-500/10 p-2.5">
          <HardDrive className="h-5 w-5 text-orange-500" />
        </div>
        <div>
          <p className="text-2xl font-bold">
            {stats?.diskSpace && stats.diskSpace.length > 0
              ? formatBytes(stats.diskSpace.reduce((acc, disk) => acc + disk.freeSpace, 0))
              : '--'}
          </p>
          <p className="text-xs text-muted-foreground">Free Space</p>
        </div>
      </StatsCard>
    </div>
  );
}
