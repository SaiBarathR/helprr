'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import type { MediaImage } from '@/types';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { SelectionCheck } from './selection-check';
import { useWatchLookup } from '@/components/jellyfin/watch-status-provider';
import { WatchStatusInline } from '@/components/jellyfin/watch-status-indicator';
import type { ArrScope } from '@/types/watch-status';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

export interface MediaTableRow {
  id: number;
  title: string;
  year: number;
  href: string;
  /** Instance the item belongs to — combined with id to form the selection key. */
  instanceId?: string;
  instanceLabel?: string;
  monitored?: boolean;
  hasFile?: boolean;
  status?: string;
  images: MediaImage[];
  // Optional fields
  qualityProfile?: string;
  rating?: number;
  sizeOnDisk?: number;
  network?: string;
  studio?: string;
  episodeProgress?: string;
  runtime?: number;
  certification?: string;
  genres?: string[];
  // Music (artist) fields
  artistType?: string;
  albumCount?: number;
  trackProgress?: string;
}

export function MediaTable({
  rows,
  visibleFields,
  type,
  onNavigate,
  watchScope,
  selectable,
  selectedKeys,
  onToggleSelect,
  getContextActionGroups,
  sortKey,
  sortDir,
  onSort,
  sortKeys,
  resetPageKey,
}: {
  rows: MediaTableRow[];
  visibleFields: string[];
  type: 'movie' | 'series' | 'artist';
  onNavigate?: () => void;
  /** Jellyfin watch scope (movies/series only); each row looks up by id+instance. */
  watchScope?: ArrScope;
  /** Selection mode: a leading checkbox column appears and row clicks toggle. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (row: MediaTableRow) => void;
  getContextActionGroups?: (row: MediaTableRow) => ContextActionGroup[];
  /** Active sort state + handler — column ids with an entry in `sortKeys` get sortable headers. */
  sortKey?: string;
  sortDir?: 'asc' | 'desc';
  onSort?: (key: string) => void;
  sortKeys?: Record<string, string>;
  /** Bump to page 1 when the upstream filters/search change. */
  resetPageKey?: unknown;
}) {
  const lookup = useWatchLookup();
  const keyOf = (row: MediaTableRow) => `${row.instanceId ?? ''}:${row.id}`;
  const isSelected = (row: MediaTableRow) => selectedKeys?.has(keyOf(row)) ?? false;

  const columns = useMemo(() => {
    const show = (field: string) => visibleFields.includes(field);
    const muted = 'text-muted-foreground truncate block';
    const cols: DataTableColumn<MediaTableRow>[] = [];

    if (selectable) {
      cols.push({
        id: 'select',
        label: '',
        width: 40,
        minWidth: 40,
        fixed: true,
        cell: (row) => (
          <button
            type="button"
            role="checkbox"
            aria-checked={isSelected(row)}
            aria-label={`Select ${row.title}`}
            // Stop propagation so this doesn't double-toggle with the row's onClick.
            onClick={(e) => {
              e.stopPropagation();
              onToggleSelect?.(row);
            }}
            className="flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <SelectionCheck selected={isSelected(row)} className="border-muted-foreground/50 bg-transparent" />
          </button>
        ),
      });
    }
    if (show('monitored')) {
      cols.push({
        id: 'monitored',
        label: '',
        width: 36,
        minWidth: 36,
        fixed: true,
        sortKey: sortKeys?.monitored,
        cell: (row) =>
          row.monitored ? (
            <Eye className="h-3.5 w-3.5 text-primary" />
          ) : (
            <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
          ),
      });
    }
    cols.push({
      id: 'title',
      label: show('title') ? (type === 'artist' ? 'Name' : 'Title') : '',
      width: 240,
      minWidth: 160,
      grow: true,
      sortKey: sortKeys?.title,
      cell: (row) => {
        const watchStatus = watchScope
          ? lookup({ scope: watchScope, instanceId: row.instanceId, arrId: row.id })
          : undefined;
        const statusDot = (
          <span
            className={`inline-block h-2 w-2 rounded-full shrink-0 ${
              row.hasFile
                ? 'bg-green-500'
                : row.monitored
                  ? row.status === 'continuing' || row.status === 'released' ? 'bg-red-500' : 'bg-blue-500'
                  : 'bg-muted-foreground'
            }`}
          />
        );
        const inner = (
          <>
            {statusDot}
            {show('title') && <span className="truncate">{row.title}</span>}
            {row.instanceLabel && (
              <span className="text-[10px] font-medium text-[var(--hpr-amber)] shrink-0">{row.instanceLabel}</span>
            )}
            {show('watchStatus') && <WatchStatusInline status={watchStatus} className="shrink-0" />}
          </>
        );
        return selectable ? (
          <span className="flex items-center gap-2">{inner}</span>
        ) : (
          <Link
            href={row.href}
            onClick={onNavigate}
            className="hover:underline flex items-center gap-2"
            aria-label={show('title') ? undefined : row.title}
          >
            {inner}
          </Link>
        );
      },
    });
    if (show('year')) {
      cols.push({
        id: 'year',
        label: 'Year',
        width: 72,
        sortKey: sortKeys?.year,
        cell: (row) => <span className={muted}>{row.year}</span>,
      });
    }
    if (show('artistType') && type === 'artist') {
      cols.push({
        id: 'artistType',
        label: 'Type',
        width: 110,
        sortKey: sortKeys?.artistType,
        cell: (row) => <span className={muted}>{row.artistType || '-'}</span>,
      });
    }
    if (show('qualityProfile')) {
      cols.push({
        id: 'qualityProfile',
        label: 'Quality',
        width: 130,
        sortKey: sortKeys?.qualityProfile,
        cell: (row) => <span className={muted}>{row.qualityProfile || '-'}</span>,
      });
    }
    if (show('network') && type === 'series') {
      cols.push({
        id: 'network',
        label: 'Network',
        width: 130,
        sortKey: sortKeys?.network,
        cell: (row) => <span className={muted}>{row.network || '-'}</span>,
      });
    }
    if (show('studio') && type === 'movie') {
      cols.push({
        id: 'studio',
        label: 'Studio',
        width: 150,
        sortKey: sortKeys?.studio,
        cell: (row) => <span className={muted}>{row.studio || '-'}</span>,
      });
    }
    if (show('albumCount') && type === 'artist') {
      cols.push({
        id: 'albumCount',
        label: 'Albums',
        width: 90,
        sortKey: sortKeys?.albumCount,
        cell: (row) => <span className={muted}>{row.albumCount ?? '-'}</span>,
      });
    }
    if (show('episodeProgress') && type === 'series') {
      cols.push({
        id: 'episodeProgress',
        label: 'Episodes',
        width: 110,
        sortKey: sortKeys?.episodeProgress,
        cell: (row) => <span className={muted}>{row.episodeProgress || '-'}</span>,
      });
    }
    if (show('trackProgress') && type === 'artist') {
      cols.push({
        id: 'trackProgress',
        label: 'Tracks',
        width: 100,
        sortKey: sortKeys?.trackProgress,
        cell: (row) => <span className={muted}>{row.trackProgress || '-'}</span>,
      });
    }
    if (show('rating')) {
      cols.push({
        id: 'rating',
        label: 'Rating',
        width: 84,
        sortKey: sortKeys?.rating,
        cell: (row) => (
          <span className={muted}>{row.rating && row.rating > 0 ? row.rating.toFixed(1) : '-'}</span>
        ),
      });
    }
    if (show('sizeOnDisk')) {
      cols.push({
        id: 'sizeOnDisk',
        label: 'Size',
        width: 96,
        align: 'right',
        sortKey: sortKeys?.sizeOnDisk,
        cell: (row) => (
          <span className={muted}>{row.sizeOnDisk ? formatBytes(row.sizeOnDisk) : '-'}</span>
        ),
      });
    }
    return cols;
    // isSelected/lookup are stable enough per render; deps below capture what
    // actually changes column construction.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleFields, type, selectable, selectedKeys, onToggleSelect, onNavigate, watchScope, lookup, sortKeys]);

  return (
    <DataTable
      tableId={`media-${type}`}
      columns={columns}
      rows={rows}
      rowKey={keyOf}
      sortKey={sortKey}
      sortDir={sortDir}
      onSort={onSort}
      resetPageKey={resetPageKey}
      onRowClick={selectable ? (row) => onToggleSelect?.(row) : undefined}
      rowClassName={(row) => (isSelected(row) ? 'bg-primary/10 hover:bg-primary/10' : undefined)}
      wrapRow={
        !selectable && getContextActionGroups
          ? (row, tr) => (
              <QuickContextMenu label={`${row.title} actions`} groups={getContextActionGroups(row)}>
                {tr}
              </QuickContextMenu>
            )
          : undefined
      }
    />
  );
}
