'use client';

import { ArrowDown, ArrowUp, Pause, HardDrive, Gauge } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { formatBytes } from '@/lib/format';
import { EditModePlaceholder } from '@/components/widgets/shared';
import type { WidgetProps } from '@/lib/widgets/types';
import type { QBittorrentSummaryResponse } from '@/types';

const DOWNLOADING_STATES = new Set([
  'downloading', 'metadl', 'forcedmetadl', 'queueddl',
  'checkingdl', 'forceddl', 'allocating', 'stalleddl',
]);

const SEEDING_STATES = new Set([
  'uploading', 'stalledup', 'queuedup', 'checkingup', 'forcedup',
]);

const PAUSED_STATES = new Set([
  'paused', 'pauseddl', 'pausedup', 'stoppeddl', 'stoppedup',
]);

interface TorrentData {
  total: number;
  downloading: number;
  seeding: number;
  paused: number;
  dlSpeed: number;
  upSpeed: number;
  dlTotal: number;
  upTotal: number;
  dlRateLimit: number;
  upRateLimit: number;
  speedLimitsMode: boolean;
}

async function fetchTorrentData(): Promise<TorrentData> {
  const res = await fetch('/api/qbittorrent/summary');
  if (!res.ok) throw new Error('Failed to fetch');
  const data: QBittorrentSummaryResponse = await res.json();
  const torrents = data.torrents || [];

  let downloading = 0, seeding = 0, paused = 0;
  for (const t of torrents) {
    const state = (t.state || '').toLowerCase();
    if (DOWNLOADING_STATES.has(state)) downloading++;
    else if (SEEDING_STATES.has(state)) seeding++;
    else if (PAUSED_STATES.has(state)) paused++;
  }

  const ti = data.transferInfo;
  return {
    total: torrents.length,
    downloading,
    seeding,
    paused,
    dlSpeed: ti?.dl_info_speed ?? 0,
    upSpeed: ti?.up_info_speed ?? 0,
    dlTotal: ti?.dl_info_data ?? 0,
    upTotal: ti?.up_info_data ?? 0,
    dlRateLimit: ti?.dl_rate_limit ?? 0,
    upRateLimit: ti?.up_rate_limit ?? 0,
    speedLimitsMode: (data.speedLimitsMode ?? 0) === 1,
  };
}

export function TorrentWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data, loading } = useWidgetData({
    fetchFn: fetchTorrentData,
    refreshInterval: Math.min(refreshInterval, 3000),
  });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-4 space-y-3">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-36" />
      </div>
    );
  }

  if (!data) {
    return editMode ? <EditModePlaceholder title="Torrents" message="No torrent data" /> : null;
  }

  if (size === 'medium') {
    return (
      <div className="rounded-xl bg-card p-4 space-y-3">
        {/* Torrent counts */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
            <span className="text-2xl font-bold tabular-nums">{data.total}</span>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="flex items-center gap-1">
              <ArrowDown className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-muted-foreground">{data.downloading}</span>
            </span>
            <span className="flex items-center gap-1">
              <ArrowUp className="h-3.5 w-3.5 text-green-400" />
              <span className="text-muted-foreground">{data.seeding}</span>
            </span>
            {data.paused > 0 && (
              <span className="flex items-center gap-1">
                <Pause className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-muted-foreground">{data.paused}</span>
              </span>
            )}
          </div>
        </div>

        {/* Transfer speeds */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ArrowDown className="h-4 w-4 text-blue-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold tabular-nums">{formatBytes(data.dlSpeed)}/s</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(data.dlTotal)} total</p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <ArrowUp className="h-4 w-4 text-green-400 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-bold tabular-nums">{formatBytes(data.upSpeed)}/s</p>
              <p className="text-[10px] text-muted-foreground">{formatBytes(data.upTotal)} total</p>
            </div>
          </div>
        </div>

        {/* Rate limits */}
        {(data.dlRateLimit > 0 || data.upRateLimit > 0) && (
          <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-border pt-2">
            <Gauge className="h-3 w-3 shrink-0" />
            <span>Limits{data.speedLimitsMode ? ' (active)' : ''}:</span>
            {data.dlRateLimit > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowDown className="h-2.5 w-2.5" />{formatBytes(data.dlRateLimit)}/s
              </span>
            )}
            {data.upRateLimit > 0 && (
              <span className="flex items-center gap-0.5">
                <ArrowUp className="h-2.5 w-2.5" />{formatBytes(data.upRateLimit)}/s
              </span>
            )}
          </div>
        )}
      </div>
    );
  }

  // large size
  return (
    <div className="rounded-xl bg-card p-4 space-y-3">
      {/* Torrent counts */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <HardDrive className="h-4 w-4 text-muted-foreground" />
          <span className="text-2xl font-bold tabular-nums">{data.total}</span>
          <span className="text-xs text-muted-foreground">torrents</span>
        </div>
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

      {/* Transfer speeds */}
      <div className="flex items-center gap-6">
        <div className="flex items-center gap-2">
          <ArrowDown className="h-4 w-4 text-blue-400" />
          <div>
            <p className="text-lg font-bold tabular-nums">{formatBytes(data.dlSpeed)}/s</p>
            <p className="text-[10px] text-muted-foreground">{formatBytes(data.dlTotal)} total</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <ArrowUp className="h-4 w-4 text-green-400" />
          <div>
            <p className="text-lg font-bold tabular-nums">{formatBytes(data.upSpeed)}/s</p>
            <p className="text-[10px] text-muted-foreground">{formatBytes(data.upTotal)} total</p>
          </div>
        </div>
      </div>

      {/* Rate limits */}
      {(data.dlRateLimit > 0 || data.upRateLimit > 0) && (
        <div className="flex items-center gap-2 text-[10px] text-muted-foreground border-t border-border pt-2">
          <Gauge className="h-3 w-3 shrink-0" />
          <span>Limits{data.speedLimitsMode ? ' (active)' : ''}:</span>
          {data.dlRateLimit > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowDown className="h-2.5 w-2.5" />{formatBytes(data.dlRateLimit)}/s
            </span>
          )}
          {data.upRateLimit > 0 && (
            <span className="flex items-center gap-0.5">
              <ArrowUp className="h-2.5 w-2.5" />{formatBytes(data.upRateLimit)}/s
            </span>
          )}
        </div>
      )}
    </div>
  );
}
