'use client';

import Link from 'next/link';
import { Check, Film, Tv } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { toCachedImageSrc } from '@/lib/image';
import { FinaleBadge, ReleaseTypeBadge } from '@/components/calendar/release-badges';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  FONT_MONO,
  HPR,
  LIST_ROW_HEIGHT,
  Pill,
  Poster,
  SectionHeader,
  ViewModeToggle,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';

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

function shortTagFor(ev: CalendarEvent): { label: string; color: string } | null {
  if (ev.finaleType) {
    return { label: 'FIN', color: HPR.rose };
  }
  if (ev.releaseType === 'cinema') return { label: 'CIN', color: HPR.pink };
  if (ev.releaseType === 'physical') return { label: 'PHY', color: HPR.amber };
  if (ev.releaseType === 'digital') return { label: 'DIG', color: HPR.cyan };
  return null;
}

export function TodayCalendarWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();
  const { visibleCount: listVisible } = useListFetchSize({
    height,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 10;
  const visibleCount = Math.max(listVisible, carouselVisible);
  const { data, loading } = useWidgetData({
    fetchFn: fetchToday,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'today-calendar',
  });
  const list = data ?? [];
  const useList = narrow || layoutVariant !== 'carousel';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const headerRight = (
    <>
      {toggleNode}
      <Link href="/calendar" style={{ color: 'inherit', textDecoration: 'none' }}>
        View all →
      </Link>
    </>
  );

  if (loading && list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Today" right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle }}>Loading…</div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Today" badge={<Pill color={HPR.amber}>0</Pill>} right={toggleNode} />
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>Nothing airing today</div>
      </div>
    );
  }

  if (useList) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader
          title="Today"
          badge={<Pill color={HPR.amber}>{list.length}</Pill>}
          right={headerRight}
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
                  {(ev.releaseType || ev.finaleType || ev.hasFile) && (
                    <div className="flex items-center gap-1" style={{ marginTop: 3 }}>
                      {ev.releaseType && <ReleaseTypeBadge type={ev.releaseType} />}
                      {ev.finaleType && <FinaleBadge type={ev.finaleType} />}
                      {Boolean(ev.hasFile) && (
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: 2,
                            padding: '0 4px',
                            height: 16,
                            borderRadius: 4,
                            background: HPR.green,
                            color: HPR.ink,
                            fontSize: 9,
                            fontWeight: 700,
                          }}
                        >
                          <Check size={10} strokeWidth={2.4} />
                        </span>)}
                    </div>
                  )}
                  <div
                    style={{
                      fontSize: 12,
                      color: HPR.fgMute,
                      marginTop: 2,
                      wordBreak: 'break-word',
                    }}
                    className='line-clamp-2 overflow-hidden text-ellipsis'
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
                    color: 'var(--hpr-fg)',
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
                href={`${ev.type === 'episode' ? `/series/${ev.seriesId}` : `/movies/${ev.movieId}`}${ev.instanceId ? `?instance=${ev.instanceId}` : ''}`}
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

  return (
    <div ref={ref}>
      <SectionHeader
        title="Today"
        badge={<Pill color={HPR.amber}>{list.length}</Pill>}
        right={headerRight}
      />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((ev) => {
          const time = formatTime(ev.date);
          const poster = getPoster(ev.images, ev.type === 'movie' ? 'radarr' : 'sonarr');
          const isMovie = ev.type === 'movie';
          const tag = shortTagFor(ev);
          const card = (
            <>
              <div style={{ position: 'relative' }}>
                <Poster
                  width={CAROUSEL_CARD_WIDTH}
                  height={CAROUSEL_CARD_HEIGHT}
                  label={ev.title}
                  tone={toneFromString(ev.title)}
                  imageUrl={poster ?? undefined}
                  timePill={time || undefined}
                  check={Boolean(ev.hasFile)}
                  badge={{
                    icon:
                      isMovie ? (
                        <Film size={11} strokeWidth={2.4} />
                      ) : (
                        <Tv size={11} strokeWidth={2.4} />
                      ),
                    color: isMovie ? HPR.blue : HPR.purple,
                  }}
                />
                {tag && (
                  <span
                    style={{
                      position: 'absolute',
                      top: 5,
                      left: 27,
                      padding: '0 5px',
                      height: 18,
                      borderRadius: 4,
                      background: 'color-mix(in oklab, var(--hpr-ink) 55%, transparent)',
                      color: tag.color,
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      display: 'inline-flex',
                      alignItems: 'center',
                    }}
                  >
                    {tag.label}
                  </span>
                )}
              </div>
              <div style={{ marginTop: 6 }}>
                <div
                  style={{
                    fontSize: 11,
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
                    fontSize: 10,
                    color: HPR.fgMute,
                    fontFamily: FONT_MONO,
                    wordBreak: 'break-word',
                  }}
                  className='line-clamp-2 overflow-hidden text-ellipsis'
                >
                  {ev.subtitle}
                </div>
              </div>
            </>
          );
          return editMode ? (
            <div key={ev.id} style={{ width: CAROUSEL_CARD_WIDTH, flexShrink: 0 }}>
              {card}
            </div>
          ) : (
            <Link
              key={ev.id}
              href={`${ev.type === 'episode' ? `/series/${ev.seriesId}` : `/movies/${ev.movieId}`}${ev.instanceId ? `?instance=${ev.instanceId}` : ''}`}
              style={{
                width: CAROUSEL_CARD_WIDTH,
                flexShrink: 0,
                textDecoration: 'none',
                color: 'inherit',
              }}
            >
              {card}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
