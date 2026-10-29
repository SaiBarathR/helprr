'use client';

import { useCallback, useMemo, type ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { DataTableColumn } from '@/components/ui/data-table';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Gauge } from 'lucide-react';
import type { QBittorrentTorrent } from '@/types';
import { formatEta, formatSpeed, formatTorrentSize } from './torrent-list';
import { TorrentRowActions, getStateBadge, torrentContextActionGroups } from './torrent-row';

/** The wide-screen table's columns, and each row wrapped in its context menu. */
export function useTorrentTable({
  allSelected,
  selectAll,
  selectedTorrents,
  toggleSelect,
  fetchDetail,
  torrentAction,
  openDeleteDrawer,
  openCategoryDrawer,
  openRename,
  canManageTorrents,
  canDeleteTorrents,
}: {
  allSelected: boolean;
  selectAll: () => void;
  selectedTorrents: Set<string>;
  toggleSelect: (hash: string) => void;
  fetchDetail: (hash: string) => void;
  torrentAction: (hash: string, action: string, extra?: Record<string, unknown>) => void;
  openDeleteDrawer: (hash: string, name: string, deleteFiles: boolean) => void;
  openCategoryDrawer: (hash: string) => void;
  openRename: (hash: string) => void;
  canManageTorrents: boolean;
  canDeleteTorrents: boolean;
}) {
  const tableColumns = useMemo((): DataTableColumn<QBittorrentTorrent>[] => [
    {
      id: 'select',
      label: (
        <label className="relative flex touch-target" data-context-menu-ignore>
          <input
            type="checkbox"
            checked={allSelected}
            onChange={selectAll}
            className="block rounded border-border"
            aria-label="Select all"
          />
        </label>
      ),
      width: 40,
      minWidth: 40,
      fixed: true,
      cell: (t) => (
        <label className="relative flex touch-target" data-context-menu-ignore>
          <input
            type="checkbox"
            checked={selectedTorrents.has(t.hash)}
            onChange={() => toggleSelect(t.hash)}
            className="block rounded border-border"
            aria-label={`Select ${t.name}`}
          />
        </label>
      ),
    },
    // Widths sum to 1008px, the content width at 1280px with the sidebar open,
    // so the default table fits without scrolling; Name absorbs any extra.
    {
      id: 'name',
      label: 'Name',
      width: 184,
      minWidth: 160,
      grow: true,
      sortKey: 'name',
      cell: (t) => (
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            className="text-sm font-medium truncate text-left hover:underline min-w-0"
            title={t.name}
            onClick={() => fetchDetail(t.hash)}
          >
            {t.name}
          </button>
          {t.category && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0 max-w-[120px] truncate">
              {t.category}
            </Badge>
          )}
          {(t.dl_limit > 0 || t.up_limit > 0) && <Gauge className="h-3 w-3 text-yellow-500 shrink-0" />}
        </div>
      ),
    },
    {
      id: 'state',
      label: 'Status',
      width: 96,
      sortKey: 'state',
      cell: (t) => getStateBadge(t.state),
    },
    {
      id: 'progress',
      label: 'Progress',
      width: 116,
      minWidth: 90,
      sortKey: 'progress',
      cell: (t) => (
        <div className="flex items-center gap-1.5">
          <Progress value={t.progress * 100} className="h-1 flex-1" />
          <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
            {(t.progress * 100).toFixed(0)}%
          </span>
        </div>
      ),
    },
    {
      id: 'size',
      label: 'Size',
      width: 80,
      align: 'right',
      sortKey: 'size',
      cell: (t) => <span className="text-xs text-muted-foreground">{formatTorrentSize(t)}</span>,
    },
    {
      id: 'dlspeed',
      label: 'DL',
      width: 88,
      align: 'right',
      sortKey: 'dlspeed',
      cell: (t) => t.dlspeed > 0
        ? <span className="text-xs text-green-500">{formatSpeed(t.dlspeed)}</span>
        : <span className="text-xs text-muted-foreground">&mdash;</span>,
    },
    {
      id: 'upspeed',
      label: 'UL',
      width: 88,
      align: 'right',
      sortKey: 'upspeed',
      cell: (t) => t.upspeed > 0
        ? <span className="text-xs text-blue-500">{formatSpeed(t.upspeed)}</span>
        : <span className="text-xs text-muted-foreground">&mdash;</span>,
    },
    {
      id: 'eta',
      label: 'ETA',
      width: 76,
      align: 'right',
      sortKey: 'eta',
      cell: (t) => (
        <span className="text-xs text-muted-foreground whitespace-nowrap">
          {t.eta > 0 && t.eta < 8640000 ? formatEta(t.eta) : '—'}
        </span>
      ),
    },
    {
      id: 'num_seeds',
      label: 'Seeds',
      width: 64,
      align: 'right',
      sortKey: 'num_seeds',
      cell: (t) => <span className="text-xs text-muted-foreground">{t.num_seeds}</span>,
    },
    {
      id: 'num_leechs',
      label: 'Peers',
      width: 64,
      align: 'right',
      sortKey: 'num_leechs',
      cell: (t) => <span className="text-xs text-muted-foreground">{t.num_leechs}</span>,
    },
    {
      id: 'ratio',
      label: 'Ratio',
      width: 64,
      align: 'right',
      sortKey: 'ratio',
      cell: (t) => <span className="text-xs text-muted-foreground">{(t.ratio ?? 0).toFixed(2)}</span>,
    },
    {
      id: 'actions',
      label: '',
      width: 48,
      minWidth: 48,
      fixed: true,
      cell: (t) => (
        <TorrentRowActions
          torrent={t}
          onTorrentAction={torrentAction}
          onOpenDeleteDrawer={openDeleteDrawer}
          onOpenCategoryDrawer={openCategoryDrawer}
          onRename={openRename}
        />
      ),
    },
  ], [allSelected, selectAll, selectedTorrents, toggleSelect, fetchDetail, torrentAction, openDeleteDrawer, openCategoryDrawer, openRename]);

  const wrapTableRow = useCallback((torrent: QBittorrentTorrent, tr: ReactElement) => (
    <QuickContextMenu
      label={`Actions for ${torrent.name}`}
      groups={torrentContextActionGroups({
        torrent,
        selected: selectedTorrents.has(torrent.hash),
        onToggleSelect: toggleSelect,
        onFetchDetail: fetchDetail,
        onTorrentAction: torrentAction,
        onOpenDeleteDrawer: openDeleteDrawer,
        onOpenCategoryDrawer: openCategoryDrawer,
        onRename: openRename,
        canManageTorrents,
        canDeleteTorrents,
      })}
    >
      {tr}
    </QuickContextMenu>
  ), [selectedTorrents, toggleSelect, fetchDetail, torrentAction, openDeleteDrawer, openCategoryDrawer, openRename, canManageTorrents, canDeleteTorrents]);

  return { tableColumns, wrapTableRow };
}
