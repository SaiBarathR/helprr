'use client';

import type { Dispatch, SetStateAction } from 'react';
import { Gauge, Pause, Play, Trash2, Zap } from 'lucide-react';
import type { DeleteDrawerState } from './torrent-delete-drawer';

/** Actions on the selected torrents, shown while any are selected. */
export function TorrentsBulkBar({
  selectedTorrents,
  canManageTorrents,
  bulkAction,
  canBandwidthTorrents,
  openBulkSpeedLimits,
  canDeleteTorrents,
  setDeleteDrawer,
  setSelectedTorrents,
}: {
  selectedTorrents: Set<string>;
  canManageTorrents: boolean;
  bulkAction: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  canBandwidthTorrents: boolean;
  openBulkSpeedLimits: () => void;
  canDeleteTorrents: boolean;
  setDeleteDrawer: Dispatch<SetStateAction<DeleteDrawerState>>;
  setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>;
}) {
  return (
    <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/60 rounded-xl">
      <span className="text-xs text-muted-foreground mx-1 shrink-0">{selectedTorrents.size}</span>
      {canManageTorrents && (
        <button
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
          onClick={() => void bulkAction('start')}
          aria-label="Start"
        >
          <Play className="h-4 w-4" />
        </button>
      )}
      {canManageTorrents && (
        <button
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
          onClick={() => void bulkAction('stop')}
          aria-label="Stop"
        >
          <Pause className="h-4 w-4" />
        </button>
      )}
      {canManageTorrents && (
        <button
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
          onClick={() => void bulkAction('forceStart')}
          aria-label="Force Start"
        >
          <Zap className="h-4 w-4" />
        </button>
      )}
      {canBandwidthTorrents && (
        <button
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
          onClick={openBulkSpeedLimits}
          aria-label="Speed Limits"
        >
          <Gauge className="h-4 w-4" />
        </button>
      )}
      {canDeleteTorrents && (
        <button
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent text-destructive"
          onClick={() => {
            const hashes = Array.from(selectedTorrents).join('|');
            setDeleteDrawer({
              open: true,
              hash: hashes,
              name: `${selectedTorrents.size} torrents`,
              deleteFiles: false,
            });
          }}
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      <div className="flex-1" />
      <button
        className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent text-xs text-muted-foreground"
        onClick={() => setSelectedTorrents(new Set())}
      >
        Clear
      </button>
    </div>
  );
}
