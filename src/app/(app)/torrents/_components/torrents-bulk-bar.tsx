'use client';

import type { Dispatch, SetStateAction } from 'react';
import { CheckCircle2, FolderCog, Gauge, Megaphone, MoreHorizontal, Pause, Play, Tag, Trash2, Zap } from 'lucide-react';
import { ResponsiveMenu, ResponsiveMenuActionItem } from '@/components/ui/responsive-menu';
import { useIsMobile } from '@/hooks/use-is-mobile';
import type { DeleteDrawerState } from './torrent-delete-drawer';

/** Actions on the selected torrents, shown while any are selected. */
export function TorrentsBulkBar({
  selectedTorrents,
  canManageTorrents,
  bulkAction,
  canBandwidthTorrents,
  openBulkSpeedLimits,
  openOrganize,
  openBulkCategory,
  canDeleteTorrents,
  setDeleteDrawer,
  setSelectedTorrents,
}: {
  selectedTorrents: Set<string>;
  canManageTorrents: boolean;
  bulkAction: (action: string, extra?: Record<string, unknown>) => Promise<boolean>;
  canBandwidthTorrents: boolean;
  openBulkSpeedLimits: () => void;
  openOrganize: () => void;
  openBulkCategory: () => void;
  canDeleteTorrents: boolean;
  setDeleteDrawer: Dispatch<SetStateAction<DeleteDrawerState>>;
  setSelectedTorrents: Dispatch<SetStateAction<Set<string>>>;
}) {
  // A phone narrower than 390px has no room for every button (and a
  // three-digit count): Location, Tags & Queue moves into More actions, and
  // below 360px the gaps close, so Clear stays in view. The button hides at
  // the same width in CSS, where max-[390px] is width < 390px.
  const below390 = useIsMobile(389.98);
  return (
    <div data-toast-clearance className="flex items-center gap-1 max-[359px]:gap-0 px-2 py-1.5 bg-muted/60 rounded-xl">
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
      {canManageTorrents && (
        <button
          className="relative touch-target min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent max-[390px]:hidden"
          onClick={openOrganize}
          aria-label="Location, Tags & Queue"
        >
          <FolderCog className="h-4 w-4" />
        </button>
      )}
      {canBandwidthTorrents && (
        <button
          className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
          onClick={openBulkSpeedLimits}
          aria-label="Speed & Share Limits"
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
              name: `${selectedTorrents.size} ${selectedTorrents.size === 1 ? 'torrent' : 'torrents'}`,
              deleteFiles: false,
            });
          }}
          aria-label="Delete"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
      {/* The less used actions, in a menu so the bar stays one row on a phone. */}
      {canManageTorrents && (
        <ResponsiveMenu
          title="More actions"
          actions
          align="end"
          trigger={(
            <button
              className="relative touch-target min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
              aria-label="More actions"
            >
              <MoreHorizontal className="h-4 w-4" />
            </button>
          )}
        >
          <ResponsiveMenuActionItem onSelect={() => void bulkAction('recheck')}>
            <CheckCircle2 className="h-4 w-4" />
            Recheck
          </ResponsiveMenuActionItem>
          <ResponsiveMenuActionItem onSelect={() => void bulkAction('reannounce')}>
            <Megaphone className="h-4 w-4" />
            Reannounce
          </ResponsiveMenuActionItem>
          <ResponsiveMenuActionItem onSelect={openBulkCategory}>
            <Tag className="h-4 w-4" />
            Set Category
          </ResponsiveMenuActionItem>
          {below390 && (
            <ResponsiveMenuActionItem onSelect={openOrganize}>
              <FolderCog className="h-4 w-4" />
              Location, Tags & Queue
            </ResponsiveMenuActionItem>
          )}
        </ResponsiveMenu>
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
