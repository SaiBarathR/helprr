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
    <div
      className="bg-card/40 overflow-hidden border border-[color:var(--hairline)]"
      style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
    >
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[color:var(--hairline)]">
              {show('monitored') && <th className="w-8 px-3 py-2.5"></th>}
              <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80" style={{ letterSpacing: '0.22em' }}>Title</th>
              {show('year') && <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden sm:table-cell" style={{ letterSpacing: '0.22em' }}>Year</th>}
              {show('qualityProfile') && <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden md:table-cell" style={{ letterSpacing: '0.22em' }}>Quality</th>}
              {show('network') && type === 'series' && <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden lg:table-cell" style={{ letterSpacing: '0.22em' }}>Network</th>}
              {show('studio') && type === 'movie' && <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden lg:table-cell" style={{ letterSpacing: '0.22em' }}>Studio</th>}
              {show('episodeProgress') && type === 'series' && <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden sm:table-cell" style={{ letterSpacing: '0.22em' }}>Episodes</th>}
              {show('rating') && <th className="text-left px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden md:table-cell" style={{ letterSpacing: '0.22em' }}>Rating</th>}
              {show('sizeOnDisk') && <th className="text-right px-3 py-2.5 tracked-caps text-[9px] text-muted-foreground/80 hidden sm:table-cell" style={{ letterSpacing: '0.22em' }}>Size</th>}
            </tr>
          </thead>
          <tbody>
            {topSpacerHeight > 0 && (
              <tr aria-hidden="true">
                <td colSpan={columnCount} style={{ height: topSpacerHeight }} />
              </tr>
            )}
            {rows.map((row) => (
              <tr key={row.id} className="border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/40 transition-colors group">
                {show('monitored') && (
                  <td className="px-3 py-2">
                    {row.monitored ? (
                      <Eye className="h-3.5 w-3.5 text-[color:var(--amber)]" />
                    ) : (
                      <EyeOff className="h-3.5 w-3.5 text-muted-foreground/50" />
                    )}
                  </td>
                )}
                <td className="px-3 py-2">
                  <Link href={row.href} onClick={onNavigate} className="flex items-center gap-2 group-hover:text-[color:var(--amber)] transition-colors">
                    <span
                      className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
                      style={{
                        background: row.hasFile
                          ? 'oklch(0.78 0.13 162)'
                          : row.monitored
                            ? row.status === 'continuing' || row.status === 'released'
                              ? 'oklch(0.66 0.20 25)'
                              : 'oklch(0.70 0.13 220)'
                            : 'oklch(0.55 0.012 75)',
                        boxShadow: row.hasFile
                          ? '0 0 6px oklch(0.78 0.13 162 / 0.5)'
                          : row.monitored
                            ? '0 0 6px oklch(0.66 0.20 25 / 0.4)'
                            : 'none',
                      }}
                    />
                    <span className="font-display text-[14px] truncate" style={{ letterSpacing: '-0.01em' }}>
                      {row.title}
                    </span>
                  </Link>
                </td>
                {show('year') && <td className="px-3 py-2 font-mono tabular text-[12px] text-muted-foreground/80 hidden sm:table-cell">{row.year}</td>}
                {show('qualityProfile') && <td className="px-3 py-2 tracked-caps text-[9px] text-muted-foreground/80 hidden md:table-cell">{row.qualityProfile || '—'}</td>}
                {show('network') && type === 'series' && <td className="px-3 py-2 text-[12px] text-muted-foreground/80 hidden lg:table-cell">{row.network || '—'}</td>}
                {show('studio') && type === 'movie' && <td className="px-3 py-2 text-[12px] text-muted-foreground/80 hidden lg:table-cell">{row.studio || '—'}</td>}
                {show('episodeProgress') && type === 'series' && <td className="px-3 py-2 font-mono tabular text-[12px] text-muted-foreground/80 hidden sm:table-cell">{row.episodeProgress || '—'}</td>}
                {show('rating') && (
                  <td className="px-3 py-2 font-mono tabular text-[12px] hidden md:table-cell">
                    {row.rating && row.rating > 0 ? (
                      <span className="text-[color:var(--amber)]">{row.rating.toFixed(1)}</span>
                    ) : (
                      <span className="text-muted-foreground/50">—</span>
                    )}
                  </td>
                )}
                {show('sizeOnDisk') && <td className="px-3 py-2 font-mono tabular text-[12px] text-muted-foreground/80 text-right hidden sm:table-cell">{row.sizeOnDisk ? formatBytes(row.sizeOnDisk) : '—'}</td>}
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
