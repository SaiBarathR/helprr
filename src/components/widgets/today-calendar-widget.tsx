'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { toCachedImageSrc } from '@/lib/image';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  HPR,
  Pill,
  Poster,
  SECTION_HEADER_HEIGHT,
  SectionHeader,
  toneFromString,
} from './bento-primitives';

const ROW_HEIGHT = 92;

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function getPoster(images: MediaImage[], hint?: 'radarr' | 'sonarr'): string | null {
  const img = images.find((i) => i.coverType === 'poster');
  return toCachedImageSrc(img?.remoteUrl || img?.url || null, hint);
}

async function fetchToday(): Promise<CalendarEvent[]> {
  const res = await fetch('/api/calendar?days=1&fullDay=true');
  if (!res.ok) return [];
  return res.json();
}

export function TodayCalendarWidget({ refreshInterval, editMode = false }: WidgetProps) {
  const { ref, height } = useElementSize<HTMLDivElement>();
  const visibleCount = useMemo(() => {
    if (height <= 0) return 6;
    return Math.max(4, Math.ceil((height - SECTION_HEADER_HEIGHT) / ROW_HEIGHT) + 3);
  }, [height]);
  const { data, loading } = useWidgetData({
    fetchFn: fetchToday,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'today-calendar',
  });
  const list = data ?? [];

  if (loading && list.length === 0) {
    return (
      <div ref={ref}>
        <SectionHeader title="Today" />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div ref={ref}>
        <SectionHeader title="Today" badge={<Pill color={HPR.amber}>0</Pill>} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>Nothing airing today</div>
      </div>
    );
  }

  return (
    <div
      ref={ref}
      style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
    >
      <SectionHeader
        title="Today"
        badge={<Pill color={HPR.amber}>{list.length}</Pill>}
        right={<span>View all →</span>}
      />
      <div
        className="no-scrollbar scroll-fade-y"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 8,
          flex: 1,
          minHeight: 0,
          overflowY: 'auto',
        }}
      >
        {list.slice(0, visibleCount).map((ev) => {
          const time = formatTime(ev.date);
          const poster = getPoster(ev.images, ev.type === 'movie' ? 'radarr' : 'sonarr');
          const isMovie = ev.type === 'movie';
          const typeColor = isMovie ? HPR.blue : HPR.purple;
          const row = (
            <div
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 12,
                padding: 8,
                background: HPR.ink,
                borderRadius: 12,
              }}
            >
              <Poster
                width={48}
                height={72}
                label={ev.title}
                tone={toneFromString(ev.title)}
                fontSize={8}
                imageUrl={poster ?? undefined}
              />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontSize: 14,
                    color: HPR.fg,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    fontWeight: 500,
                  }}
                >
                  {ev.title}
                </div>
                <div
                  style={{
                    fontSize: 12,
                    color: HPR.fgMute,
                    marginTop: 2,
                    wordBreak: 'break-word',
                  }}
                >
                  {ev.subtitle}
                </div>
                {time && (
                  <div
                    style={{
                      fontSize: 12,
                      color: HPR.fgMute,
                      marginTop: 2,
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                    }}
                  >
                    {time}
                  </div>
                )}
              </div>
              <div
                style={{
                  width: 20,
                  height: 20,
                  borderRadius: 6,
                  background: typeColor,
                  color: '#fff',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                  marginRight: 4,
                  marginTop: 2,
                  opacity: 0.85,
                }}
              >
                {isMovie ? <Film size={11} strokeWidth={2.4} /> : <Tv size={11} strokeWidth={2.4} />}
              </div>
            </div>
          );
          return editMode ? (
            <div key={ev.id}>{row}</div>
          ) : (
            <Link
              key={ev.id}
              href={ev.type === 'episode' ? `/series/${ev.seriesId}` : `/movies/${ev.movieId}`}
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              {row}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
