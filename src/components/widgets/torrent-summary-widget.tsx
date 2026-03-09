'use client';

import { ArrowDown, ArrowUp, Pause, HardDrive } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { EditModePlaceholder } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';

interface TorrentSummary {
  total: number;
  downloading: number;
  seeding: number;
  paused: number;
}

const DOWNLOADING_STATES = new Set([
  'downloading',
  'metadl',
  'forcedmetadl',
  'queueddl',
  'checkingdl',
  'forceddl',
  'allocating',
  'stalleddl',
]);

const SEEDING_STATES = new Set([
  'uploading',
  'stalledup',
  'queuedup',
  'checkingup',
  'forcedup',
]);

const PAUSED_STATES = new Set([
  'paused',
  'pauseddl',
  'pausedup',
]);

async function fetchTorrentSummary(): Promise<TorrentSummary> {
  const res = await fetch('/api/qbittorrent/summary');
  if (!res.ok) throw new Error('Failed to fetch');
  const data = await res.json();
  const torrents = data.torrents || [];

  let downloading = 0, seeding = 0, paused = 0;
  for (const t of torrents) {
    const state = (t.state || '').toLowerCase();
    if (DOWNLOADING_STATES.has(state)) {
      downloading++;
    } else if (SEEDING_STATES.has(state)) {
      seeding++;
    } else if (PAUSED_STATES.has(state)) {
      paused++;
    } else {
      // Explicitly ignore uncounted states such as error, missingFiles,
      // checkingResumeData, moving, and unknown.
    }
  }

  return { total: torrents.length, downloading, seeding, paused };
}

export function TorrentSummaryWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data, loading } = useWidgetData({ fetchFn: fetchTorrentSummary, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-4">
        <Skeleton className="h-6 w-16 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (!data) {
    return editMode ? <EditModePlaceholder title="Torrent Summary" message="No torrent data" /> : null;
  }

  if (size === 'small') {
    return (
      <div className="rounded-xl bg-card p-3 flex items-center gap-3">
        <HardDrive className="h-4 w-4 text-muted-foreground" />
        <span className="text-lg font-bold tabular-nums">{data.total}</span>
        <div className="flex gap-2 text-xs">
          {data.downloading > 0 && (
            <span className="flex items-center gap-0.5 text-blue-400">
              <ArrowDown className="h-3 w-3" />{data.downloading}
            </span>
          )}
          {data.seeding > 0 && (
            <span className="flex items-center gap-0.5 text-green-400">
              <ArrowUp className="h-3 w-3" />{data.seeding}
            </span>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card p-4">
      <p className="text-xs text-muted-foreground mb-2">Torrents</p>
      <div className="flex items-center gap-4">
        <span className="text-2xl font-bold tabular-nums">{data.total}</span>
        <div className="flex items-center gap-3 text-xs">
          <span className="flex items-center gap-1">
            <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
            <span className="text-muted-foreground">{data.downloading} DL</span>
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3.5 w-3.5 text-green-400" />
            <span className="text-muted-foreground">{data.seeding} Seed</span>
          </span>
          {data.paused > 0 && (
            <span className="flex items-center gap-1">
              <Pause className="h-3.5 w-3.5 text-amber-400" />
              <span className="text-muted-foreground">{data.paused} Paused</span>
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
