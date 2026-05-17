'use client';

import Link from 'next/link';
import { Film, Tv, Download, HardDrive } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { formatBytes } from '@/lib/format';
import type { WidgetProps } from '@/lib/widgets/types';
import type { ServicesStatsResponse } from '@/types/service-stats';
import { Eyebrow, FONT_DISPLAY, FONT_MONO, HPR, ICON_HIDE_THRESHOLD, mix } from './bento-primitives';

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

export function StatsGridWidget({ refreshInterval, editMode = false, narrow = false }: WidgetProps) {
  const { ref, width } = useElementSize<HTMLDivElement>();
  // Each tile is half the widget width minus the 8px gap between tiles.
  const tileWidth = width > 0 ? (width - 8) / 2 : 0;
  const hideIcon = tileWidth > 0 && tileWidth < ICON_HIDE_THRESHOLD;
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
    <div ref={ref}>
      <Eyebrow style={{ marginBottom: 10 }}>Overview</Eyebrow>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
          gap: 8,
        }}
      >
        {tiles.map((t, i) => {
          const inner = (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: narrow ? 8 : 10,
                padding: narrow ? '8px 9px' : '10px 12px',
                background: HPR.ink,
                border: `1px solid ${HPR.hairline}`,
                borderRadius: 8,
                minWidth: 0,
              }}
            >
              {!hideIcon && (
                <div
                  style={{
                    width: narrow ? 28 : 32,
                    height: narrow ? 28 : 32,
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
                    fontSize: narrow ? 16 : 18,
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
