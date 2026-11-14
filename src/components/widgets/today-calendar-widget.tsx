'use client';
import { ApiError } from '@/lib/query-fetch';

import Link from '@/components/ui/app-link';
import { Check, Disc3, Film, Tv, CalendarDays } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { widgetFetch } from '@/lib/widgets/widget-fetch';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import { FinaleBadge, ReleaseTypeBadge } from '@/components/calendar/release-badges';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';
import {
  CAROUSEL_CARD_HEIGHT,
  CAROUSEL_CARD_WIDTH,
  CAROUSEL_GAP,
  EmptyState,
  FONT_MONO,
  HPR,
  LIST_ROW_HEIGHT,
  Pill,
  Poster,
  SECTION_HEADER_HEIGHT,
  SectionHeader,
  ViewModeToggle,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';
import { formatTime as formatDisplayTime } from '@/lib/date-format';
import { compareCalendarEvents, isReleaseDayEvent } from '@/lib/release-day';
import { getDeviceTimeZone } from '@/lib/timezone';

// The header plus a carousel card's poster (with its badges and air time) and
// title line. A shorter cell, such as a phone's two-row default, cut the
// poster and hid the title and time, so it shows the list, which scrolls.
const CAROUSEL_FIT_HEIGHT = SECTION_HEADER_HEIGHT + CAROUSEL_CARD_HEIGHT + 24;

/**
 * An episode's air time. A film or album release is a day (release-day.ts):
 * "All day", as on the Calendar page; upstream's UTC midnight read as a time
 * was "5:30 AM" in India and the afternoon before west of UTC.
 */
function formatTime(ev: CalendarEvent): string {
  if (isReleaseDayEvent(ev)) return 'All day';
  const d = new Date(ev.date);
  if (!Number.isFinite(d.getTime())) return '';
  return formatDisplayTime(d);
}

function getPoster(images: MediaImage[], hint?: ImageServiceHint): string | null {
  const img =
    images.find((i) => i.coverType === 'poster') ??
    images.find((i) => i.coverType === 'cover');
  return toCachedImageSrc(img?.remoteUrl || img?.url || null, hint);
}

/** Detail-page link for a calendar event, by media type. Mirrors the calendar
 * page's `eventHref` so albums (Lidarr) route to the music detail page instead
 * of `/movies/undefined`. Carries the owning instance. */
function eventHref(ev: CalendarEvent): string {
  const q = ev.instanceId ? `?instance=${ev.instanceId}` : '';
  if (ev.type === 'episode') return `/series/${ev.seriesId}${q}`;
  if (ev.type === 'album') return `/music/album/${ev.albumId}${q}`;
  return `/movies/${ev.movieId}${q}`;
}

function posterHint(type: CalendarEvent['type']): ImageServiceHint {
  if (type === 'movie') return 'radarr';
  if (type === 'album') return 'lidarr';
  return 'sonarr';
}

function typeIcon(type: CalendarEvent['type']) {
  if (type === 'movie') return <Film size={11} strokeWidth={2.4} />;
  if (type === 'album') return <Disc3 size={11} strokeWidth={2.4} />;
  return <Tv size={11} strokeWidth={2.4} />;
}

function typeColor(type: CalendarEvent['type']): string {
  if (type === 'movie') return HPR.blue;
  if (type === 'album') return HPR.green;
  return HPR.purple;
}

async function fetchToday(signal?: AbortSignal): Promise<CalendarEvent[]> {
  // This device's today, as the Calendar page shows it, not the server's.
  const path = `/api/calendar?days=1&fullDay=true&tz=${encodeURIComponent(getDeviceTimeZone())}`;
  // An offline snapshot from the worker shows the shared "saved data" notice, as Calendar does.
  const res = await widgetFetch(path, { signal });
  if (!res.ok) throw new ApiError(res.status, 'Request failed');
  // Listed as Calendar lists them (all-day first, then by time), not upstream's instant order.
  return ((await res.json()) as CalendarEvent[]).sort(compareCalendarEvents);
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
  const { data, loading, error, offline } = useWidgetData({
    fetchFn: fetchToday,
    refreshInterval,
    enabled: !editMode,
    cacheKey: 'today-calendar',
  });
  const list = data ?? [];
  // Unmeasured (0) keeps the chosen layout until the cell's height is known.
  const carouselFits = height === 0 || height >= CAROUSEL_FIT_HEIGHT;
  const useList = narrow || layoutVariant !== 'carousel' || !carouselFits;
  const toggleNode = !narrow && carouselFits && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const headerRight = (
    <>
      {toggleNode}
      <Link href="/calendar" aria-label="View all" style={{ color: 'inherit', textDecoration: 'none' }}>
        <span className="@max-[219px]/cell:hidden">View all </span>→
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
        <EmptyState>
          <CalendarDays size={18} />
          {/* Past the saved copy's five minutes (or with none), a failed load is
              not an empty day: say why, as the Calendar page does. */}
          {offline ? "You're offline" : error ?? 'Nothing airing today'}
        </EmptyState>
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
            const time = formatTime(ev);
            const poster = getPoster(ev.images, posterHint(ev.type));
            const row = (
              <div
                className="gap-3 @max-[219px]/cell:gap-2"
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  padding: 8,
                  background: HPR.ink,
                  borderRadius: 12,
                }}
              >
                {/* Poster is decoration — dropped on tiny cells so the title keeps width. */}
                <div className="shrink-0 @max-[159px]/cell:hidden">
                  <Poster
                    width={48}
                    height={72}
                    label={ev.title}
                    tone={toneFromString(ev.title)}
                    fontSize={8}
                    imageUrl={poster ?? undefined}
                  />
                </div>
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
                    // Badges wrap onto extra lines on narrow cells instead of clipping.
                    <div className="flex flex-wrap items-center gap-1" style={{ marginTop: 3 }}>
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
                {/* Media-type icon is decoration — hidden on compact cells. */}
                <div
                  className="flex items-center justify-center @max-[219px]/cell:hidden"
                  style={{
                    width: 20,
                    height: 20,
                    borderRadius: 6,
                    background: typeColor(ev.type),
                    color: 'var(--hpr-fg)',
                    flexShrink: 0,
                    marginRight: 4,
                    marginTop: 2,
                    opacity: 0.85,
                  }}
                >
                  {typeIcon(ev.type)}
                </div>
              </div>
            );
            return editMode ? (
              <div key={ev.id}>{row}</div>
            ) : (
              <Link
                key={ev.id}
                href={eventHref(ev)}
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
    // The cell's full height, as in the list, so the fit above measures the cell.
    <div ref={ref} style={{ height: '100%', minHeight: 0 }}>
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
          const time = formatTime(ev);
          const poster = getPoster(ev.images, posterHint(ev.type));
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
                    icon: typeIcon(ev.type),
                    color: typeColor(ev.type),
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
              href={eventHref(ev)}
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
