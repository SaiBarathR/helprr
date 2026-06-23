'use client';

import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import type { MediaImage } from '@/types';
import { cn } from '@/lib/utils';
import { SelectionCheck } from './selection-check';
import { useWatchLookup } from '@/components/jellyfin/watch-status-provider';
import { WatchStatusInline } from '@/components/jellyfin/watch-status-indicator';
import type { ArrScope } from '@/types/watch-status';

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
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  onNavigate,
  watchScope,
  selectable,
  selectedKeys,
  onToggleSelect,
}: {
  rows: MediaTableRow[];
  visibleFields: string[];
  type: 'movie' | 'series' | 'artist';
  topSpacerHeight?: number;
  bottomSpacerHeight?: number;
  onNavigate?: () => void;
  /** Jellyfin watch scope (movies/series only); each row looks up by id+instance. */
  watchScope?: ArrScope;
  /** Selection mode: a leading checkbox column appears and row clicks toggle. */
  selectable?: boolean;
  selectedKeys?: Set<string>;
  onToggleSelect?: (row: MediaTableRow) => void;
}) {
  const lookup = useWatchLookup();
  const show = (field: string) => visibleFields.includes(field);
  const keyOf = (row: MediaTableRow) => `${row.instanceId ?? ''}:${row.id}`;
  const isSelected = (row: MediaTableRow) => selectedKeys?.has(keyOf(row)) ?? false;
  const columnCount = [
    Boolean(selectable),
    show('monitored'),
    true,
    show('year'),
    show('artistType') && type === 'artist',
    show('qualityProfile'),
    show('network') && type === 'series',
    show('studio') && type === 'movie',
    show('albumCount') && type === 'artist',
    show('episodeProgress') && type === 'series',
    show('trackProgress') && type === 'artist',
    show('rating'),
    show('sizeOnDisk'),
  ].filter(Boolean).length;

  return (
    <div className="rounded-xl bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-xs text-muted-foreground">
              {selectable && <th className="w-9 px-3 py-2"></th>}
              {show('monitored') && <th className="w-8 px-3 py-2"></th>}
              <th className="text-left px-3 py-2 font-medium">Title</th>
              {show('year') && <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Year</th>}
              {show('artistType') && type === 'artist' && <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Type</th>}
              {show('qualityProfile') && <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Quality</th>}
              {show('network') && type === 'series' && <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Network</th>}
              {show('studio') && type === 'movie' && <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Studio</th>}
              {show('albumCount') && type === 'artist' && <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Albums</th>}
              {show('episodeProgress') && type === 'series' && <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Episodes</th>}
              {show('trackProgress') && type === 'artist' && <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Tracks</th>}
              {show('rating') && <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Rating</th>}
              {show('sizeOnDisk') && <th className="text-right px-3 py-2 font-medium hidden sm:table-cell">Size</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: topSpacerHeight }} />
              </tr>
            )}
            {rows.map((row) => {
              const selected = isSelected(row);
              const watchStatus = watchScope ? lookup({ scope: watchScope, instanceId: row.instanceId, arrId: row.id }) : undefined;
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
              return (
              <tr
                key={keyOf(row)}
                onClick={selectable ? () => onToggleSelect?.(row) : undefined}
                className={cn(
                  'transition-colors',
                  selectable ? 'cursor-pointer' : '',
                  selected ? 'bg-primary/10' : 'hover:bg-muted/30'
                )}
              >
                {selectable && (
                  <td className="px-3 py-2">
                    <button
                      type="button"
                      role="checkbox"
                      aria-checked={selected}
                      aria-label={`Select ${row.title}`}
                      // Stop propagation so this doesn't double-toggle with the row's onClick.
                      onClick={(e) => {
                        e.stopPropagation();
                        onToggleSelect?.(row);
                      }}
                      className="flex items-center justify-center rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <SelectionCheck selected={selected} className="border-muted-foreground/50 bg-transparent" />
                    </button>
                  </td>
                )}
                {show('monitored') && (
                  <td className="px-3 py-2">
                    {row.monitored ? (
                      <Eye className="h-3.5 w-3.5 text-primary" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground" />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  {selectable ? (
                    <span className="flex items-center gap-2">
                      {statusDot}
                      <span className="truncate">{row.title}</span>
                      {row.instanceLabel && (
                        <span className="text-[10px] font-medium text-[var(--hpr-amber)] shrink-0">{row.instanceLabel}</span>
                      )}
                      <WatchStatusInline status={watchStatus} className="shrink-0" />
                    </span>
                  ) : (
                    <Link href={row.href} onClick={onNavigate} className="hover:underline flex items-center gap-2">
                      {statusDot}
                      <span className="truncate">{row.title}</span>
                      {row.instanceLabel && (
                        <span className="text-[10px] font-medium text-[var(--hpr-amber)] shrink-0">{row.instanceLabel}</span>
                      )}
                      <WatchStatusInline status={watchStatus} className="shrink-0" />
                    </Link>
                  )}
                </td>
                {show('year') && <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{row.year}</td>}
                {show('artistType') && type === 'artist' && <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{row.artistType || '-'}</td>}
                {show('qualityProfile') && <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{row.qualityProfile || '-'}</td>}
                {show('network') && type === 'series' && <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{row.network || '-'}</td>}
                {show('studio') && type === 'movie' && <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{row.studio || '-'}</td>}
                {show('albumCount') && type === 'artist' && <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{row.albumCount ?? '-'}</td>}
                {show('episodeProgress') && type === 'series' && <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{row.episodeProgress || '-'}</td>}
                {show('trackProgress') && type === 'artist' && <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{row.trackProgress || '-'}</td>}
                {show('rating') && <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{row.rating && row.rating > 0 ? row.rating.toFixed(1) : '-'}</td>}
                {show('sizeOnDisk') && <td className="px-3 py-2 text-muted-foreground text-right hidden sm:table-cell">{row.sizeOnDisk ? formatBytes(row.sizeOnDisk) : '-'}</td>}
              </tr>
              );
            })}
            {bottomSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: bottomSpacerHeight }} />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
