'use client';

import { useCallback, useMemo, type ReactElement } from 'react';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import type { DataTableColumn } from '@/components/ui/data-table';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Gauge } from 'lucide-react';
import type { QBittorrentTorrent } from '@/types';
import { formatDateTime } from '@/lib/date-format';
import { formatDistanceToNowShort } from '@/lib/format';
import type { TorrentsTableColumn } from '@/lib/store';
import { formatBytes, formatEta, formatSpeed, formatTorrentSize } from './torrent-list';
import { TorrentRowActions, TorrentTagChips, getStateBadge, torrentContextActionGroups } from './torrent-row';
import { parseTorrentTags } from './torrent-tags';
import { formatShareLimit } from './share-limits-section';

const dash = <span className="text-xs text-muted-foreground">&mdash;</span>;

/** A qBittorrent Unix-seconds date, or a dash for 0 / -1 (not yet). */
function dateCell(seconds: number | undefined) {
  if (!seconds || seconds <= 0) return dash;
  const text = formatDateTime(seconds * 1000, { dateStyle: 'medium', timeStyle: 'short' });
  return <span className="text-xs text-muted-foreground whitespace-nowrap truncate" title={text}>{text}</span>;
}

/**
 * A torrent's limit as its drawer and settings name it ("Global (Unlimited)",
 * "2"): its own setting, with the limit in force while it uses the global one.
 */
function limitCell(kind: 'ratio' | 'time', own: number | undefined, effective: number | undefined) {
  if (own === undefined && effective === undefined) return dash;
  const text = formatShareLimit(kind, own ?? -2, effective);
  return <span className="block truncate text-xs text-muted-foreground" title={text}>{text}</span>;
}

/** The picker's names for the columns a user can show or hide, in table order. */
export const TORRENT_TABLE_COLUMN_LABELS: Record<TorrentsTableColumn, string> = {
  state: 'Status',
  progress: 'Progress',
  size: 'Size',
  dlspeed: 'Download speed',
  upspeed: 'Upload speed',
  eta: 'ETA',
  num_seeds: 'Seeds',
  num_leechs: 'Peers',
  ratio: 'Ratio',
  tags: 'Tags',
  added_on: 'Added on',
  completion_on: 'Completed on',
  last_activity: 'Last activity',
  tracker_host: 'Tracker',
  save_path: 'Save path',
  availability: 'Availability',
  downloaded: 'Downloaded',
  uploaded: 'Uploaded',
  ratio_limit: 'Ratio limit',
  seeding_time_limit: 'Seeding limit',
};

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
  canSelect,
  visibleColumns,
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
  /** No checkbox column without a bulk action (selectionAllowed). */
  canSelect: boolean;
  /** The picker's choice; Name, the checkbox and the actions always show. */
  visibleColumns: readonly TorrentsTableColumn[];
}) {
  const tableColumns = useMemo((): DataTableColumn<QBittorrentTorrent>[] => ([
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
      id: 'tags',
      label: 'Tags',
      width: 140,
      minWidth: 80,
      cell: (t) => {
        const tags = parseTorrentTags(t.tags);
        return tags.length > 0 ? <TorrentTagChips tags={tags} max={2} /> : dash;
      },
    },
    {
      id: 'added_on',
      label: 'Added on',
      width: 148,
      sortKey: 'added_on',
      cell: (t) => dateCell(t.added_on),
    },
    {
      id: 'completion_on',
      label: 'Completed on',
      width: 148,
      sortKey: 'completion_on',
      cell: (t) => dateCell(t.completion_on),
    },
    {
      id: 'last_activity',
      label: 'Last activity',
      width: 148,
      // "less than a minute ago" is wider than most: cut it rather than run into the next column.
      cell: (t) => (t.last_activity && t.last_activity > 0
        ? (
          <span
            className="block truncate text-xs text-muted-foreground whitespace-nowrap"
            title={formatDateTime(t.last_activity * 1000, { dateStyle: 'medium', timeStyle: 'short' })}
          >
            {formatDistanceToNowShort(new Date(t.last_activity * 1000).toISOString(), '—')}
          </span>
        )
        : dash),
    },
    {
      id: 'tracker_host',
      label: 'Tracker',
      width: 140,
      minWidth: 80,
      // The host name alone (projectTorrentForSummary): a tracker URL can hold a passkey.
      cell: (t) => (t.tracker_host
        ? <span className="block text-xs text-muted-foreground truncate" title={t.tracker_host}>{t.tracker_host}</span>
        : dash),
    },
    {
      id: 'save_path',
      label: 'Save path',
      width: 180,
      minWidth: 100,
      cell: (t) => (t.save_path
        ? <span className="block text-xs text-muted-foreground truncate" title={t.save_path}>{t.save_path}</span>
        : dash),
    },
    {
      id: 'availability',
      label: 'Availability',
      width: 88,
      align: 'right',
      // qBittorrent sends -1 while it isn't downloading.
      cell: (t) => (t.availability >= 0
        ? <span className="text-xs text-muted-foreground">{t.availability.toFixed(2)}</span>
        : dash),
    },
    {
      id: 'downloaded',
      label: 'Downloaded',
      width: 96,
      align: 'right',
      sortKey: 'downloaded',
      cell: (t) => <span className="text-xs text-muted-foreground">{formatBytes(t.downloaded ?? 0)}</span>,
    },
    {
      id: 'uploaded',
      label: 'Uploaded',
      width: 96,
      align: 'right',
      sortKey: 'uploaded',
      cell: (t) => <span className="text-xs text-muted-foreground">{formatBytes(t.uploaded ?? 0)}</span>,
    },
    {
      id: 'ratio_limit',
      label: 'Ratio limit',
      width: 140,
      align: 'right',
      cell: (t) => limitCell('ratio', t.ratio_limit, t.max_ratio),
    },
    {
      id: 'seeding_time_limit',
      label: 'Seeding limit',
      width: 140,
      align: 'right',
      cell: (t) => limitCell('time', t.seeding_time_limit, t.max_seeding_time),
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
  ] satisfies DataTableColumn<QBittorrentTorrent>[]).filter((column) => {
    if (column.id === 'select') return canSelect;
    if (column.id === 'name' || column.id === 'actions') return true;
    return visibleColumns.includes(column.id as TorrentsTableColumn);
  }), [allSelected, selectAll, selectedTorrents, toggleSelect, fetchDetail, torrentAction, openDeleteDrawer, openCategoryDrawer, openRename, canSelect, visibleColumns]);

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
        canSelect,
      })}
    >
      {tr}
    </QuickContextMenu>
  ), [selectedTorrents, toggleSelect, fetchDetail, torrentAction, openDeleteDrawer, openCategoryDrawer, openRename, canManageTorrents, canDeleteTorrents, canSelect]);

  return { tableColumns, wrapTableRow };
}
