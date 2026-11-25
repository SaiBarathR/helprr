'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { Progress } from '@/components/ui/progress';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { SwipeRow } from '@/components/ui/swipe-row';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import {
  Play,
  Pause,
  Zap,
  Trash2,
  MoreVertical,
  ArrowDown,
  ArrowUp,
  Gauge,
  CheckCircle2,
  Megaphone,
  Tag,
  Pencil,
  Info,
} from 'lucide-react';
import type { QBittorrentTorrent } from '@/types';
import { useCan } from '@/components/permission-provider';
import { PAUSED_STATES, formatBytes, torrentStateBadge, formatEta, formatSpeed, formatTorrentSize, torrentSizeUnknown } from './torrent-list';
import { parseTorrentTags } from './torrent-tags';

export function getStateBadge(state: string) {
  const s = torrentStateBadge(state);
  return <Badge variant={s.variant} className="text-[10px] px-1.5 py-0">{s.label}</Badge>;
}

/**
 * A torrent's tags as small chips on one line: the first `max`, then "+N" for
 * the rest. A long tag shrinks to an ellipsis, so the line never wraps (the
 * card list is virtualized at a fixed row height) or runs off a phone screen.
 * The chips are hidden from screen readers, which hear the full list instead.
 * `relative` keeps that sr-only text (absolutely positioned) inside the
 * table's horizontal scroller: escaping it, a tags cell off to the right
 * widened the page, and a phone's layout viewport grew to fit.
 * `yieldFirst`: in a crowded line the chips shrink before their neighbours,
 * down to one small chip and "+N".
 */
export function TorrentTagChips({ tags, max, className, yieldFirst = false }: { tags: string[]; max: number; className?: string; yieldFirst?: boolean }) {
  const shown = tags.slice(0, max);
  const more = tags.length - shown.length;
  return (
    <span
      className={cn(
        'relative flex min-w-0 items-center gap-1',
        // A small chip is 2rem; "+N" and the gap about 1.75rem more.
        yieldFirst && (more > 0 ? 'shrink-[100] min-w-[3.75rem]' : 'shrink-[100] min-w-8'),
        className,
      )}
      title={tags.join(', ')}
      data-tag-chips=""
    >
      <span className="sr-only">Tags: {tags.join(', ')}</span>
      {shown.map((tag) => (
        <Badge
          key={tag}
          variant="secondary"
          className="block min-w-[2rem] max-w-[96px] shrink truncate text-center text-[10px] px-1.5 py-0"
          aria-hidden
        >
          {tag}
        </Badge>
      ))}
      {more > 0 && (
        <Badge variant="secondary" className="shrink-0 text-[10px] px-1.5 py-0" aria-hidden>+{more}</Badge>
      )}
    </span>
  );
}

// --- Row actions dropdown (shared by card and table rows) ---

export interface TorrentRowProps {
  torrent: QBittorrentTorrent;
  selected: boolean;
  onToggleSelect: (hash: string) => void;
  onFetchDetail: (hash: string) => void;
  onTorrentAction: (hash: string, action: string, extra?: Record<string, unknown>) => void;
  onOpenDeleteDrawer: (hash: string, name: string, deleteFiles: boolean) => void;
  onOpenCategoryDrawer: (hash: string) => void;
  onRename: (hash: string) => void;
}

/**
 * Selecting torrents is only for their bulk actions: Start, Stop and the rest
 * (manage), Speed & Share Limits (bandwidth), Delete (delete). Without any of
 * them a selection bar would offer nothing but Clear.
 */
export function selectionAllowed(canManage: boolean, canDelete: boolean, canBandwidth: boolean): boolean {
  return canManage || canDelete || canBandwidth;
}

export function torrentContextActionGroups({
  torrent,
  selected,
  onToggleSelect,
  onFetchDetail,
  onTorrentAction,
  onOpenDeleteDrawer,
  onOpenCategoryDrawer,
  onRename,
  canManageTorrents,
  canDeleteTorrents,
  canSelect,
}: TorrentRowProps & {
  canManageTorrents: boolean;
  canDeleteTorrents: boolean;
  /** Whether the user has any bulk action (selectionAllowed). */
  canSelect: boolean;
}): ContextActionGroup[] {
  return [
    {
      id: 'navigation',
      actions: [
        {
          id: 'view-details',
          label: 'View details',
          icon: <Info className="h-4 w-4" />,
          onSelect: () => onFetchDetail(torrent.hash),
        },
        ...(canSelect ? [{
          id: 'toggle-selection',
          label: selected ? 'Deselect' : 'Select',
          icon: <CheckCircle2 className="h-4 w-4" />,
          onSelect: () => onToggleSelect(torrent.hash),
        }] : []),
      ],
    },
    {
      id: 'control',
      actions: canManageTorrents
        ? [
            {
              id: 'start',
              label: 'Start',
              icon: <Play className="h-4 w-4" />,
              onSelect: () => onTorrentAction(torrent.hash, 'start'),
            },
            {
              id: 'stop',
              label: 'Stop',
              icon: <Pause className="h-4 w-4" />,
              onSelect: () => onTorrentAction(torrent.hash, 'stop'),
            },
            {
              id: 'force-start',
              label: 'Force Start',
              icon: <Zap className="h-4 w-4" />,
              onSelect: () => onTorrentAction(torrent.hash, 'forceStart'),
            },
          ]
        : [],
    },
    {
      id: 'manage',
      actions: canManageTorrents
        ? [
            {
              id: 'recheck',
              label: 'Recheck',
              icon: <CheckCircle2 className="h-4 w-4" />,
              onSelect: () => onTorrentAction(torrent.hash, 'recheck'),
            },
            {
              id: 'reannounce',
              label: 'Reannounce',
              icon: <Megaphone className="h-4 w-4" />,
              onSelect: () => onTorrentAction(torrent.hash, 'reannounce'),
            },
            {
              id: 'set-category',
              label: 'Set Category',
              icon: <Tag className="h-4 w-4" />,
              onSelect: () => onOpenCategoryDrawer(torrent.hash),
            },
            {
              id: 'rename',
              label: 'Rename',
              icon: <Pencil className="h-4 w-4" />,
              onSelect: () => onRename(torrent.hash),
            },
          ]
        : [],
    },
    {
      id: 'destructive',
      actions: canDeleteTorrents
        ? [
            {
              id: 'delete-keep-files',
              label: 'Delete (keep files)',
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              onSelect: () => onOpenDeleteDrawer(torrent.hash, torrent.name, false),
            },
            {
              id: 'delete-with-files',
              label: 'Delete with files',
              icon: <Trash2 className="h-4 w-4" />,
              destructive: true,
              onSelect: () => onOpenDeleteDrawer(torrent.hash, torrent.name, true),
            },
          ]
        : [],
    },
  ];
}

export function TorrentRowActions({
  torrent,
  onTorrentAction,
  onOpenDeleteDrawer,
  onOpenCategoryDrawer,
  onRename,
  triggerClassName,
}: Omit<TorrentRowProps, 'selected' | 'onToggleSelect' | 'onFetchDetail'> & { triggerClassName?: string }) {
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  if (!canManageTorrents && !canDeleteTorrents) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className={triggerClassName ?? 'h-7 w-7 shrink-0'}
          aria-label="Torrent actions"
        >
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManageTorrents && (
          <>
            <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'start')}>
              <Play className="mr-2 h-4 w-4" /> Start
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'stop')}>
              <Pause className="mr-2 h-4 w-4" /> Stop
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'forceStart')}>
              <Zap className="mr-2 h-4 w-4" /> Force Start
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'recheck')}>
              <CheckCircle2 className="mr-2 h-4 w-4" /> Recheck
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'reannounce')}>
              <Megaphone className="mr-2 h-4 w-4" /> Reannounce
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onOpenCategoryDrawer(torrent.hash)}>
              <Tag className="mr-2 h-4 w-4" /> Set Category
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onRename(torrent.hash)}>
              <Pencil className="mr-2 h-4 w-4" /> Rename
            </DropdownMenuItem>
          </>
        )}
        {canManageTorrents && canDeleteTorrents && <DropdownMenuSeparator />}
        {canDeleteTorrents && (
          <>
            <DropdownMenuItem onClick={() => onOpenDeleteDrawer(torrent.hash, torrent.name, false)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete (keep files)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onOpenDeleteDrawer(torrent.hash, torrent.name, true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete with files
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- TorrentRow component (card view) ---

export const TorrentRow = memo(function TorrentRow({
  torrent,
  selected,
  onToggleSelect,
  onFetchDetail,
  onTorrentAction,
  onOpenDeleteDrawer,
  onOpenCategoryDrawer,
  onRename,
}: TorrentRowProps) {
  const hasSpeedLimit = torrent.dl_limit > 0 || torrent.up_limit > 0;
  const tags = parseTorrentTags(torrent.tags);
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  const canSelect = selectionAllowed(canManageTorrents, canDeleteTorrents, useCan('torrents.bandwidth'));
  const stopped = PAUSED_STATES.has(torrent.state);
  const contextGroups = torrentContextActionGroups({
    torrent,
    selected,
    onToggleSelect,
    onFetchDetail,
    onTorrentAction,
    onOpenDeleteDrawer,
    onOpenCategoryDrawer,
    onRename,
    canManageTorrents,
    canDeleteTorrents,
    canSelect,
  });

  return (
    <SwipeRow
      contentClassName="bg-card"
      leftAction={canManageTorrents ? {
        label: stopped ? 'Start' : 'Stop',
        icon: stopped ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />,
        className: 'bg-primary text-primary-foreground',
        onAction: () => onTorrentAction(torrent.hash, stopped ? 'start' : 'stop'),
      } : undefined}
      rightAction={canDeleteTorrents ? {
        label: 'Delete',
        icon: <Trash2 className="h-4 w-4" />,
        className: 'bg-destructive text-destructive-foreground',
        onAction: () => onOpenDeleteDrawer(torrent.hash, torrent.name, false),
      } : undefined}
    >
    <QuickContextMenu label={`Actions for ${torrent.name}`} groups={contextGroups}>
    <div className="px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        {/* The label carries the 44px hit area (a native checkbox can't), and
            is marked so a long press on it selects instead of opening the menu. */}
        {canSelect && (
          <label className="relative mt-1 flex touch-target" data-context-menu-ignore>
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(torrent.hash)}
              className="rounded border-border"
              aria-label={`Select ${torrent.name}`}
            />
          </label>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <button
              className="text-sm font-medium truncate text-left hover:underline"
              onClick={() => onFetchDetail(torrent.hash)}
            >
              {torrent.name}
            </button>
            <TorrentRowActions
              torrent={torrent}
              onTorrentAction={onTorrentAction}
              onOpenDeleteDrawer={onOpenDeleteDrawer}
              onOpenCategoryDrawer={onOpenCategoryDrawer}
              onRename={onRename}
              triggerClassName="h-7 w-7 shrink-0 -mt-0.5"
            />
          </div>

          {/* One line: the list is virtualized at a fixed row height, so the
              category and tags shrink to an ellipsis rather than wrap. Phones
              show one tag (and "+N"): with a long state, a size, a category
              and a speed limit, two did not fit at 320px. The tags give way
              first (yieldFirst), so the category keeps its name and the two
              never read as the same cut-off text. */}
          <div className="flex min-w-0 items-center gap-1.5 mt-1 overflow-hidden">
            {getStateBadge(torrent.state)}
            <span className="shrink-0 whitespace-nowrap text-[11px] text-muted-foreground">{formatTorrentSize(torrent)}</span>
            {hasSpeedLimit && (
              <Gauge className="h-3 w-3 shrink-0 text-yellow-500" />
            )}
            {torrent.category && (
              <Badge variant="outline" className="block min-w-[2rem] shrink truncate text-[10px] px-1.5 py-0 max-w-[120px]">
                {torrent.category}
              </Badge>
            )}
            {tags.length > 0 && (
              <>
                <TorrentTagChips tags={tags} max={1} yieldFirst className="sm:hidden" />
                <TorrentTagChips tags={tags} max={2} yieldFirst className="max-sm:hidden" />
              </>
            )}
          </div>

          <div className="mt-2">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1 flex-wrap gap-x-2">
              <span>{(torrent.progress * 100).toFixed(1)}%</span>
              <span className="flex items-center flex-wrap gap-x-2">
                {torrent.dlspeed > 0 && (
                  <span className="text-green-500">
                    <ArrowDown className="inline h-3 w-3" /> {formatSpeed(torrent.dlspeed)}
                  </span>
                )}
                {torrent.upspeed > 0 && (
                  <span className="text-blue-500">
                    <ArrowUp className="inline h-3 w-3" /> {formatSpeed(torrent.upspeed)}
                  </span>
                )}
                {torrent.eta > 0 && torrent.eta < 8640000 && (
                  <span>ETA: {formatEta(torrent.eta)}</span>
                )}
              </span>
            </div>
            <Progress value={torrent.progress * 100} className="h-1" />
          </div>

          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
            <span>Seeds: {torrent.num_seeds}</span>
            <span>Peers: {torrent.num_leechs}</span>
            <span>Ratio: {(torrent.ratio ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
            <span>DL: {formatBytes(torrent.downloaded ?? 0)}</span>
            <span>UL: {formatBytes(torrent.uploaded ?? 0)}</span>
            {torrent.progress < 1 && (torrent.amount_left > 0 || torrentSizeUnknown(torrent)) && (
              <span>Rem: {torrentSizeUnknown(torrent) ? '—' : formatBytes(torrent.amount_left)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
    </QuickContextMenu>
    </SwipeRow>
  );
}, (prevProps, nextProps) => prevProps.selected === nextProps.selected && prevProps.torrent === nextProps.torrent);
