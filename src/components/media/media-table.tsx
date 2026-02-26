'use client';

import Link from 'next/link';
import { Eye, EyeOff } from 'lucide-react';
import type { MediaImage } from '@/types';

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
}

export function MediaTable({
  rows,
  visibleFields,
  type,
  topSpacerHeight = 0,
  bottomSpacerHeight = 0,
  onNavigate,
}: {
  rows: MediaTableRow[];
  visibleFields: string[];
  type: 'movie' | 'series';
  topSpacerHeight?: number;
  bottomSpacerHeight?: number;
  onNavigate?: () => void;
}) {
  const show = (field: string) => visibleFields.includes(field);
  const columnCount = [
    show('monitored'),
    true,
    show('year'),
    show('qualityProfile'),
    show('network') && type === 'series',
    show('studio') && type === 'movie',
    show('episodeProgress') && type === 'series',
    show('rating'),
    show('sizeOnDisk'),
  ].filter(Boolean).length;

  return (
    <div className="rounded-xl bg-card overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border/50 text-xs text-muted-foreground">
              {show('monitored') && <th className="w-8 px-3 py-2"></th>}
              <th className="text-left px-3 py-2 font-medium">Title</th>
              {show('year') && <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Year</th>}
              {show('qualityProfile') && <th className="text-left px-3 py-2 font-medium hidden md:table-cell">Quality</th>}
              {show('network') && type === 'series' && <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Network</th>}
              {show('studio') && type === 'movie' && <th className="text-left px-3 py-2 font-medium hidden lg:table-cell">Studio</th>}
              {show('episodeProgress') && type === 'series' && <th className="text-left px-3 py-2 font-medium hidden sm:table-cell">Episodes</th>}
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
            {rows.map((row) => (
              <tr key={row.id} className="hover:bg-muted/30 transition-colors">
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
                  <Link href={row.href} onClick={onNavigate} className="hover:underline flex items-center gap-2">
                    <span
                      className={`inline-block h-2 w-2 rounded-full shrink-0 ${
                        row.hasFile
                          ? 'bg-green-500'
                          : row.monitored
                            ? row.status === 'continuing' || row.status === 'released' ? 'bg-red-500' : 'bg-blue-500'
                            : 'bg-zinc-500'
                      }`}
                    />
                    <span className="truncate">{row.title}</span>
                  </Link>
                </td>
                {show('year') && <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{row.year}</td>}
                {show('qualityProfile') && <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{row.qualityProfile || '-'}</td>}
                {show('network') && type === 'series' && <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{row.network || '-'}</td>}
                {show('studio') && type === 'movie' && <td className="px-3 py-2 text-muted-foreground hidden lg:table-cell">{row.studio || '-'}</td>}
                {show('episodeProgress') && type === 'series' && <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{row.episodeProgress || '-'}</td>}
                {show('rating') && <td className="px-3 py-2 text-muted-foreground hidden md:table-cell">{row.rating && row.rating > 0 ? row.rating.toFixed(1) : '-'}</td>}
                {show('sizeOnDisk') && <td className="px-3 py-2 text-muted-foreground text-right hidden sm:table-cell">{row.sizeOnDisk ? formatBytes(row.sizeOnDisk) : '-'}</td>}
              </tr>
            ))}
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
