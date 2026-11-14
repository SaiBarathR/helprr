'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback, useState } from 'react';
import Link from '@/components/ui/app-link';
import { Check, Disc3, Film, Tv, Calendar } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { widgetFetch } from '@/lib/widgets/widget-fetch';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowSafe } from '@/lib/format';
import { isToday, isTomorrow } from 'date-fns';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import type { CalendarEvent, MediaImage, MovieReleaseType } from '@/types';
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
  SectionHeader,
  ViewModeToggle,
  toneFromString,
} from './bento-primitives';
import { useDashboardLayout } from './dashboard-layout-context';
import { CompactRailTile } from './compact-rail-tile';
import { ReleaseTypeBadge } from '@/components/calendar/release-badges';
import { formatDate, formatDateTime, formatTime } from '@/lib/date-format';
import { calendarEventDate, calendarEventDayKey, compareCalendarEvents, isReleaseDayEvent } from '@/lib/release-day';

/** A calendar event with every release type of its film on that day (see mergeFilmReleaseDays). */
export type UpcomingEvent = CalendarEvent & { releaseTypes?: MovieReleaseType[] };

/**
 * One row per film and day. Radarr gives a film one event per release type,
 * so a physical and a digital release on the same day read as two identical
 * rows; they become one that keeps both types. Expects Calendar's order.
 */
export function mergeFilmReleaseDays(events: CalendarEvent[]): UpcomingEvent[] {
  const out: UpcomingEvent[] = [];
  const byFilmDay = new Map<string, UpcomingEvent>();
  for (const ev of events) {
    if (ev.type !== 'movie' || !ev.releaseType || ev.movieId == null) {
      out.push(ev);
      continue;
    }
    const key = `${ev.instanceId ?? ''}|${ev.movieId}|${calendarEventDayKey(ev)}`;
    const row = byFilmDay.get(key);
    if (row) {
      if (!row.releaseTypes!.includes(ev.releaseType)) row.releaseTypes!.push(ev.releaseType);
      continue;
    }
    const merged: UpcomingEvent = { ...ev, releaseTypes: [ev.releaseType] };
    byFilmDay.set(key, merged);
    out.push(merged);
  }
  return out;
}

// The Today widget's short tags, for the carousel card and the 2×1 tile.
const RELEASE_TAG: Record<MovieReleaseType, string> = { cinema: 'CIN', physical: 'PHY', digital: 'DIG' };
// The Today widget's tag colours, for the 2×1 tile's coloured tags.
const RELEASE_TAG_COLOR: Record<MovieReleaseType, string> = { cinema: HPR.pink, physical: HPR.amber, digital: HPR.cyan };

function withReleaseTags(text: string, ev: UpcomingEvent): string {
  return [text, ...(ev.releaseTypes ?? []).map((t) => RELEASE_TAG[t])].filter(Boolean).join(' · ');
}

const DAYS_OPTIONS = [7, 14, 30] as const;
const STORAGE_KEY = 'helprr-upcoming-days';

// A film or album release is a day (release-day.ts): its date with no time,
// and its distance from the start of that day here, not from upstream's UTC
// midnight (the evening before west of UTC, 5:30 AM in India).
function formatEventDate(ev: CalendarEvent): string {
  const d = calendarEventDate(ev);
  if (!Number.isFinite(d.getTime())) return '';
  // By its kind, not by a midnight hour: where that midnight does not exist
  // (a DST start, as in Santiago) local midnight of the day reads 01:00.
  // isReleaseDayEvent, not isAllDayEvent: this request has no scheduled alerts (no includeScheduled).
  if (isReleaseDayEvent(ev) || (d.getHours() === 0 && d.getMinutes() === 0)) return formatDate(d, { month: 'short', day: 'numeric' });
  return formatDateTime(d, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

/** The list row's day and, for a timed event, its time apart, so each can show or hide whole. */
function eventDateParts(ev: CalendarEvent): string[] {
  const d = calendarEventDate(ev);
  if (!Number.isFinite(d.getTime())) return [];
  if (isReleaseDayEvent(ev) || (d.getHours() === 0 && d.getMinutes() === 0)) return [formatDate(d, { month: 'short', day: 'numeric' })];
  return [formatDate(d, { month: 'short', day: 'numeric' }), formatTime(d)];
}

function eventDistance(ev: CalendarEvent): string {
  const d = calendarEventDate(ev);
  // A release is the whole day: today's read "Today", not "About 12 hours ago"
  // from its midnight (nor tomorrow's "In about 12 hours").
  if (isReleaseDayEvent(ev) && isToday(d)) return 'Today';
  if (isReleaseDayEvent(ev) && isTomorrow(d)) return 'Tomorrow';
  return formatDistanceToNowSafe(Number.isFinite(d.getTime()) ? d.toISOString() : ev.date);
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

function getStoredDays(): number {
  if (typeof window === 'undefined') return 14;
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    const parsed = stored ? parseInt(stored, 10) : NaN;
    return DAYS_OPTIONS.includes(parsed as typeof DAYS_OPTIONS[number]) ? parsed : 14;
  } catch {
    // localStorage can throw in private mode, sandboxed iframes, or when
    // storage is disabled. Fall back to the default.
    return 14;
  }
}

export function UpcomingWidget({
  refreshInterval,
  editMode = false,
  narrow = false,
  rowSpan,
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const [days, setDays] = useState(() => getStoredDays());
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();

  const fetchUpcoming = useCallback(async (signal?: AbortSignal): Promise<UpcomingEvent[]> => {
    const path = `/api/calendar?days=${days}`;
    // An offline snapshot from the worker shows the shared "saved data" notice, as Calendar does.
    const res = await widgetFetch(path, { signal });
    if (!res.ok) throw new ApiError(res.status, 'Request failed');
    // Listed as Calendar lists them (by day here, all-day first), not upstream's instant order.
    return mergeFilmReleaseDays(((await res.json()) as CalendarEvent[]).sort(compareCalendarEvents));
  }, [days]);

  const { data, loading, error, offline } = useWidgetData({
    fetchFn: fetchUpcoming,
    refreshInterval,
    enabled: !editMode,
    cacheKey: `upcoming-${days}d`,
  });
  const list = data ?? [];
  const useList = narrow || layoutVariant === 'list';
  const toggleNode = !narrow && instanceId ? (
    <ViewModeToggle
      value={useList ? 'list' : 'carousel'}
      onChange={(next) => setWidgetLayoutOverride(instanceId, next, { mobile: mobileGrid })}
    />
  ) : null;
  const { visibleCount: listVisible } = useListFetchSize({
    height,
    rowHeight: LIST_ROW_HEIGHT,
  });
  const carouselVisible = width > 0
    ? Math.ceil(width / (CAROUSEL_CARD_WIDTH + CAROUSEL_GAP)) + 4
    : 12;
  const visibleCount = Math.max(listVisible, carouselVisible);

  function handleDaysChange() {
    const idx = DAYS_OPTIONS.indexOf(days as typeof DAYS_OPTIONS[number]);
    const next = DAYS_OPTIONS[(idx + 1) % DAYS_OPTIONS.length];
    setDays(next);
    if (typeof window !== 'undefined') {
      try {
        localStorage.setItem(STORAGE_KEY, String(next));
      } catch {
        // Storage may be full or disabled; the in-memory state is still updated.
      }
    }
  }

  const dayBadge = (
    // A one-column phone cell has no room for it beside the title (it was
    // clipped); the switch stays on the larger sizes, as the 2×1 tile does.
    <button
      type="button"
      className="@max-[99px]/cell:hidden"
      onClick={editMode ? undefined : handleDaysChange}
      style={{ border: 'none', padding: 0, background: 'transparent', cursor: editMode ? 'default' : 'pointer' }}
    >
      <Pill color={HPR.amber}>
        {narrow ? `${days} D ▾` : `${days} DAYS ▾`}
      </Pill>
    </button>
  );

  // The one-row half-width phone cell (2×1): the Discover rails' compact tile.
  // The days switch stays on the larger sizes.
  if (narrow && (rowSpan ?? 1) <= 1) {
    const top = list[0];
    return (
      <CompactRailTile
        title="Upcoming"
        viewAllHref="/calendar"
        editMode={editMode}
        // Edit mode doesn't load, so "nothing" would be untrue there (as For You).
        note={loading ? 'Loading…' : editMode ? 'Next release' : offline ? "You're offline" : error ?? 'Nothing upcoming'}
        item={top ? {
          href: eventHref(top),
          title: top.title,
          meta: formatEventDate(top),
          // Coloured tags after the date, without " · " between them, so "Nov 17
          // PHY DIG" fits a 320px phone's tile whole instead of losing DIG to an ellipsis.
          tags: top.releaseTypes?.map((t) => ({ label: RELEASE_TAG[t], color: RELEASE_TAG_COLOR[t] })),
          imageUrl: getPoster(top.images, posterHint(top.type)),
        } : null}
      />
    );
  }

  if (loading && list.length === 0) {
    return (
      <div
        ref={ref}
        style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}
      >
        <SectionHeader title="Upcoming" badge={dayBadge} right={toggleNode} />
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
        <SectionHeader title="Upcoming" badge={dayBadge} right={toggleNode} />
        <EmptyState>
          <Calendar size={18} />
          {/* Past the saved copy's five minutes (or with none), a failed load is
              not an empty day: say why, as the Calendar page does. */}
          {offline ? "You're offline" : error ?? 'Nothing upcoming'}
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
          title="Upcoming"
          badge={dayBadge}
          right={
            <>
              {toggleNode}
              <Link href="/calendar" style={{ color: 'inherit', textDecoration: 'none' }}>
                <span className="@max-[219px]/cell:hidden">View all </span>→
              </Link>
            </>
          }
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
          {list.slice(0, visibleCount).map((ev) =>
            editMode ? (
              <UpcomingRow key={ev.id} ev={ev} />
            ) : (
              <Link
                key={ev.id}
                href={eventHref(ev)}
                style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
              >
                <UpcomingRow ev={ev} />
              </Link>
            ),
          )}
        </div>
      </div>
    );
  }

  return (
    <div ref={ref}>
      <SectionHeader
        title="Upcoming"
        badge={dayBadge}
        right={
          <>
            {toggleNode}
            <Link href="/calendar" style={{ color: 'inherit', textDecoration: 'none' }}>
              <span className="@max-[219px]/cell:hidden">View all </span>→
            </Link>
          </>
        }
      />
      <div
        className="no-scrollbar"
        style={{ display: 'flex', gap: CAROUSEL_GAP, overflowX: 'auto', paddingBottom: 4 }}
      >
        {list.slice(0, visibleCount).map((ev) => {
          const poster = getPoster(ev.images, posterHint(ev.type));
          const card = (
            <>
              <Poster
                width={CAROUSEL_CARD_WIDTH}
                height={CAROUSEL_CARD_HEIGHT}
                label={ev.title}
                tone={toneFromString(ev.title)}
                imageUrl={poster ?? undefined}
                check={Boolean(ev.hasFile)}
                timePill={eventDistance(ev)}
                badge={
                  !ev.hasFile
                    ? {
                        icon: typeIcon(ev.type),
                        color: typeColor(ev.type),
                      }
                    : undefined
                }
              />
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
                  }}
                  className='line-clamp-1 md:line-clamp-2 overflow-hidden text-ellipsis'
                >
                  {ev.subtitle}
                </div>
                <div
                  style={{
                    fontSize: 9,
                    color: HPR.amber,
                    fontFamily: FONT_MONO,
                    marginTop: 2,
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                >
                  {withReleaseTags(formatEventDate(ev), ev)}
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

// Sized down as the Today widget's rows are, so a half-width phone cell keeps
// whole words instead of a one-letter title and a subtitle and year wrapped
// a few letters per line beside the poster.
function UpcomingRow({ ev }: { ev: UpcomingEvent }) {
  const poster = getPoster(ev.images, posterHint(ev.type));
  return (
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
          check={ev.hasFile}
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
        {(ev.releaseTypes?.length || ev.hasFile) && (
          // As the Today widget: badges wrap onto extra lines on narrow cells instead of clipping.
          // A row holding only the narrow-cell "Downloaded" badge is hidden with it,
          // or its margin would set that row 3px lower than its neighbours.
          <div
            className={`${ev.releaseTypes?.length ? 'flex' : 'hidden @max-[159px]/cell:flex'} flex-wrap items-center gap-1`}
            style={{ marginTop: 3 }}
          >
            {ev.releaseTypes?.map((t) => <ReleaseTypeBadge key={t} type={t} fitCell />)}
            {ev.hasFile && (
              // "Downloaded" is the poster's check; where the poster is hidden it
              // is a badge here, as the Today widget shows it.
              <span
                role="img"
                aria-label="Downloaded"
                className="hidden @max-[159px]/cell:inline-flex"
                style={{
                  alignItems: 'center',
                  padding: '0 4px',
                  height: 16,
                  borderRadius: 4,
                  background: HPR.green,
                  color: HPR.ink,
                }}
              >
                <Check size={10} strokeWidth={2.4} />
              </span>
            )}
          </div>
        )}
        {/* Whole words (break-word split "S02E07" mid-word); a one-column phone
            cell has no room for a second line, so it keeps the title and date. */}
        <div
          style={{
            fontSize: 12,
            color: HPR.fgMute,
            marginTop: 2,
          }}
          className="line-clamp-2 overflow-hidden text-ellipsis @max-[79px]/cell:hidden"
        >
          {ev.subtitle}
        </div>
        {/* Whole parts on one line: the time or distance that doesn't fit wraps
            onto a second line the fixed height hides, instead of ending in "…". */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            columnGap: '0.6em',
            height: 16,
            lineHeight: '16px',
            overflow: 'hidden',
            color: HPR.fgMute,
            fontFamily: FONT_MONO,
            marginTop: 2,
            whiteSpace: 'nowrap',
          }}
          // In a one-column phone cell the smaller size fits "Nov 17" whole (it read "Nov…").
          className="text-[12px] @max-[79px]/cell:text-[10px]"
        >
          {eventDateParts(ev).map((part, i) => (
            <span key={i} style={i === 0 ? { maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis' } : undefined}>{part}</span>
          ))}
          <span>· {eventDistance(ev)}</span>
        </div>
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
}
