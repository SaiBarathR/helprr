'use client';

import Link from 'next/link';
import { Film, Tv, Download, HardDrive } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { ServicesStatsResponse } from '@/types/service-stats';
import { Eyebrow, FONT_DISPLAY, FONT_MONO, HPR, ICON_HIDE_HEIGHT_THRESHOLD, ICON_HIDE_THRESHOLD, mix } from './bento-primitives';

async function fetchStats(): Promise<ServicesStatsResponse> {
  const res = await fetch('/api/services/stats');
  if (!res.ok) throw new Error('Failed to fetch stats');
  return res.json();
}

interface Tile {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color: string;
  href?: string;
}

export function StatsGridWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const isVertical = height > 0 && height < ICON_HIDE_HEIGHT_THRESHOLD;
  const compact = narrow || isVertical;
  // In vertical mode the four tiles share a single horizontal row, so each
  // tile gets ~1/4 of the widget width instead of ~1/2.
  const tileDivisor = isVertical ? 4 : 2;
  const isSingleRow = tileDivisor === 4;
  const tileWidth = width > 0 ? (width - 8 * (tileDivisor - 1)) / tileDivisor : 0;
  const hideIcon = tileWidth > 0 && height > 0 && (tileWidth < ICON_HIDE_THRESHOLD || height < ICON_HIDE_HEIGHT_THRESHOLD);
  const { data, loading } = useWidgetData({
    fetchFn: fetchStats,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'stats-grid',
  });

  const free =
    data?.diskSpace && data.diskSpace.length > 0
      ? formatBytes(data.diskSpace.reduce((acc, d) => acc + d.freeSpace, 0))
      : '--';

  const tiles: Tile[] = [
    {
      icon: <Film size={15} />,
      label: 'Movies',
      value: loading ? '–' : data?.totalMovies ?? '--',
      color: HPR.blue,
      href: '/movies',
    },
    {
      icon: <Tv size={15} />,
      label: 'TV',
      value: loading ? '–' : data?.totalSeries ?? '--',
      sub:
        !loading && data?.jellyfin?.episodeCount !== undefined
          ? `${data.jellyfin.episodeCount.toLocaleString()} eps`
          : undefined,
      color: HPR.purple,
      href: '/series',
    },
    {
      icon: <Download size={15} />,
      label: 'Downloading',
      value: loading ? '–' : data?.activeDownloads ?? '--',
      color: HPR.green,
      href: '/activity',
    },
    {
      icon: <HardDrive size={15} />,
      label: 'Free Space',
      value: free,
      color: HPR.amber,
    },
  ];

  return (
    <div ref={ref} style={{ position: 'relative', height: '100%' }}>
      {!hideIcon && <Eyebrow style={{ marginBottom: 10 }}>Overview</Eyebrow>}
      <div
        style={{
          //grid should fill all available space, but gap should be consistent regardless of size
          display: 'grid',
          gridTemplateColumns: `repeat(${isVertical ? 4 : 2}, minmax(0, 1fr))`,
          gap: isSingleRow ? 3 : 8,
          marginTop: isSingleRow ? 3 : 0,
          height: `calc(100% - ${!hideIcon ? 28 : 0}px)`,
        }}

      >
        {tiles.map((t, i) => {
          const inner = (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: isSingleRow ? 1 : compact ? 8 : 10,
                padding: compact ? '8px 9px' : '10px 12px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 8,
                minWidth: 0,
              }}
            >
              {!hideIcon && (
                <div
                  style={{
                    width: compact ? 28 : 32,
                    height: compact ? 28 : 32,
                    borderRadius: 7,
                    background: mix(t.color, 12),
                    color: t.color,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {t.icon}
                </div>
              )}
              <div style={{ minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontFamily: FONT_DISPLAY,
                    fontSize: compact ? 16 : 18,
                    color: HPR.fg,
                    fontWeight: 600,
                    lineHeight: 1.05,
                    letterSpacing: '-0.02em',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t.value}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: HPR.fgMute,
                    marginTop: 2,
                    display: 'flex',
                    gap: 4,
                    alignItems: 'baseline',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {t.label}
                  {t.sub && (
                    <span
                      style={{
                        color: HPR.fgSubtle,
                        fontFamily: FONT_MONO,
                        fontSize: 9,
                      }}
                    >
                      {t.sub}
                    </span>
                  )}
                </div>
              </div>
            </div>
          );
          if (!t.href || editMode) {
            return <div key={i}>{inner}</div>;
          }
          return (
            <Link key={i} href={t.href} style={{ textDecoration: 'none' }}>
              {inner}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
