'use client';

import { memo } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
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
import { PAUSED_STATES, formatBytes, formatEta, formatSpeed, formatTorrentSize, torrentSizeUnknown } from './torrent-list';

export function getStateBadge(state: string) {
  const stateMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    downloading: { label: 'Downloading', variant: 'default' },
    stalledDL: { label: 'Stalled', variant: 'secondary' },
    uploading: { label: 'Seeding', variant: 'default' },
    stalledUP: { label: 'Seeding', variant: 'secondary' },
    pausedDL: { label: 'Paused', variant: 'outline' },
    pausedUP: { label: 'Paused', variant: 'outline' },
    stoppedDL: { label: 'Stopped', variant: 'outline' },
    stoppedUP: { label: 'Stopped', variant: 'outline' },
    queuedDL: { label: 'Queued', variant: 'secondary' },
    queuedUP: { label: 'Queued', variant: 'secondary' },
    checkingDL: { label: 'Checking', variant: 'secondary' },
    checkingUP: { label: 'Checking', variant: 'secondary' },
    forcedDL: { label: 'Forced DL', variant: 'default' },
    forcedUP: { label: 'Forced UL', variant: 'default' },
    missingFiles: { label: 'Missing', variant: 'destructive' },
    error: { label: 'Error', variant: 'destructive' },
    moving: { label: 'Moving', variant: 'secondary' },
  };

  const s = stateMap[state] || { label: state, variant: 'secondary' as const };
  return <Badge variant={s.variant} className="text-[10px] px-1.5 py-0">{s.label}</Badge>;
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
}: TorrentRowProps & {
  canManageTorrents: boolean;
  canDeleteTorrents: boolean;
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
        {
          id: 'toggle-selection',
          label: selected ? 'Deselect' : 'Select',
          icon: <CheckCircle2 className="h-4 w-4" />,
          onSelect: () => onToggleSelect(torrent.hash),
        },
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
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
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
        <label className="relative mt-1 flex touch-target" data-context-menu-ignore>
          <input
            type="checkbox"
            checked={selected}
            onChange={() => onToggleSelect(torrent.hash)}
            className="rounded border-border"
            aria-label={`Select ${torrent.name}`}
          />
        </label>
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

          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {getStateBadge(torrent.state)}
            <span className="text-[11px] text-muted-foreground">{formatTorrentSize(torrent)}</span>
            {torrent.category && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate max-w-[120px]">
                {torrent.category}
              </Badge>
            )}
            {hasSpeedLimit && (
              <Gauge className="h-3 w-3 text-yellow-500" />
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
