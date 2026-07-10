'use client';
import { ApiError } from '@/lib/query-fetch';

import { useCallback, useState } from 'react';
import Link from 'next/link';
import { Disc3, Film, Tv } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { useElementSize } from '@/lib/widgets/use-element-size';
import { useListFetchSize } from '@/lib/widgets/use-list-fetch-size';
import { formatDistanceToNowSafe } from '@/lib/format';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
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

const DAYS_OPTIONS = [7, 14, 30] as const;
const STORAGE_KEY = 'helprr-upcoming-days';

function formatEventDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (!Number.isFinite(d.getTime())) return '';
  const month = d.toLocaleString('en-US', { month: 'short' });
  const day = d.getDate();
  const hours = d.getHours();
  const mins = d.getMinutes();
  if (hours === 0 && mins === 0) return `${month} ${day}`;
  const time = d.toLocaleString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
  return `${month} ${day}, ${time}`;
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
  layoutVariant,
  instanceId,
  mobileGrid = false,
}: WidgetProps) {
  const [days, setDays] = useState(() => getStoredDays());
  const { ref, width, height } = useElementSize<HTMLDivElement>();
  const { setWidgetLayoutOverride } = useDashboardLayout();

  const fetchUpcoming = useCallback(async (): Promise<CalendarEvent[]> => {
    const res = await fetch(`/api/calendar?days=${days}`);
    if (!res.ok) throw new ApiError(res.status, 'Request failed');
    return res.json();
  }, [days]);

  const { data, loading } = useWidgetData({
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
    <button
      type="button"
      onClick={editMode ? undefined : handleDaysChange}
      style={{ border: 'none', padding: 0, background: 'transparent', cursor: editMode ? 'default' : 'pointer' }}
    >
      <Pill color={HPR.amber}>
        {narrow ? `${days} D ▾` : `${days} DAYS ▾`}
      </Pill>
    </button>
  );

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
        <div style={{ fontSize: 11, color: HPR.fgSubtle, padding: '6px 0' }}>
          Nothing upcoming
        </div>
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
                timePill={formatDistanceToNowSafe(ev.date)}
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
                  {formatEventDate(ev.date)}
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

function UpcomingRow({ ev }: { ev: CalendarEvent }) {
  const poster = getPoster(ev.images, posterHint(ev.type));
  return (
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
        check={ev.hasFile}
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
        <div
          style={{
            fontSize: 12,
            color: HPR.fgMute,
            fontFamily: FONT_MONO,
            marginTop: 2,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
          }}
        >
          {formatEventDate(ev.date)} · {formatDistanceToNowSafe(ev.date)}
        </div>
      </div>
      <div
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          background: typeColor(ev.type),
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
        {typeIcon(ev.type)}
      </div>
    </div>
  );
}
