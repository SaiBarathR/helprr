'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';
import { MediaTile } from '@/components/jellyfin-streaming/media-tile';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import type { CalendarEvent } from '@/types';

const DAY_MS = 86_400_000;
const EPISODE_WINDOW_DAYS = 7;
const MONTHS_AHEAD = 3;

/** Season premieres are the signal for "a new season is coming". */
const PREMIERE_RE = /^S(\d+)E0*1\b/i;

function hintFor(event: CalendarEvent): ImageServiceHint {
  return event.type === 'movie' ? 'radarr' : event.type === 'album' ? 'lidarr' : 'sonarr';
}

function posterFor(event: CalendarEvent): string | null {
  const image = event.images?.find((i) => i.coverType === 'poster')
    ?? event.images?.find((i) => i.coverType === 'cover')
    ?? event.images?.find((i) => i.coverType === 'fanart');
  return toCachedImageSrc(image?.remoteUrl || image?.url || null, hintFor(event));
}

/**
 * Arr's 16:9 art is `fanart`; screenshots are the episode-level equivalent.
 * Deliberately not `banner` — arr banners are about 5:1, so covering a 16:9
 * frame with one magnifies a thin slice. Returning null instead lets the tile
 * fall back to the poster, which crops far better.
 */
function backdropFor(event: CalendarEvent): string | null {
  const image = event.images?.find((i) => i.coverType === 'fanart')
    ?? event.images?.find((i) => i.coverType === 'screenshot');
  return toCachedImageSrc(image?.remoteUrl || image?.url || null, hintFor(event));
}

/**
 * Airtimes come from Sonarr/Radarr with real precision, so show them. Midnight
 * usually means "date only" upstream rather than an actual 00:00 broadcast.
 */
function airsAt(iso: string): string | null {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const midnight = date.getHours() === 0 && date.getMinutes() === 0;
  return date.toLocaleString([], {
    day: 'numeric',
    month: 'short',
    ...(midnight ? {} : { hour: 'numeric', minute: '2-digit' }),
  });
}

function countdown(iso: string): string {
  const days = Math.ceil((new Date(iso).getTime() - Date.now()) / DAY_MS);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Tomorrow';
  if (days < 30) return `${days} days`;
  const months = Math.round(days / 30);
  return months <= 1 ? '1 month' : `${months} months`;
}

/**
 * Upcoming rails sourced from the arr calendar rather than Jellyfin.
 *
 * Jellyfin's `/Shows/Upcoming` only knows about episodes, and only within its
 * own window. The owner wants three distinct horizons — movies and new seasons
 * three months out, episodes one week out — which is exactly what Sonarr and
 * Radarr already publish through Helprr's calendar endpoint. One request covers
 * all three; the rails are derived client-side.
 */
export function UpcomingRails() {
  const canSeeCalendar = useCan('calendar.view');
  const range = useMemo(() => {
    const start = new Date();
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    end.setMonth(end.getMonth() + MONTHS_AHEAD);
    return { start: start.toISOString(), end: end.toISOString(), startMs: start.getTime() };
  }, []);

  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'upcoming-calendar', range.start, range.end],
    queryFn: jsonFetcher<CalendarEvent[]>(`/api/calendar?start=${range.start}&end=${range.end}`),
    enabled: canSeeCalendar,
    staleTime: 5 * 60_000,
  });

  const rails = useMemo(() => {
    const events = query.data ?? [];
    const future = events.filter((event) => new Date(event.date).getTime() >= range.startMs);
    const weekEnd = range.startMs + EPISODE_WINDOW_DAYS * DAY_MS;

    return [
      {
        key: 'movies',
        title: `Movies in the next ${MONTHS_AHEAD} months`,
        items: future.filter((event) => event.type === 'movie'),
      },
      {
        key: 'seasons',
        title: `New seasons in the next ${MONTHS_AHEAD} months`,
        items: future.filter((event) => event.type === 'episode' && PREMIERE_RE.test(event.subtitle ?? '')),
      },
      {
        key: 'episodes',
        title: 'Airing this week',
        items: future.filter((event) => event.type === 'episode' && new Date(event.date).getTime() <= weekEnd),
      },
    ].filter((rail) => rail.items.length > 0);
  }, [query.data, range.startMs]);

  if (!canSeeCalendar || rails.length === 0) return null;

  return (
    <>
      {rails.map((rail) => (
        <MediaRail key={rail.key} title={rail.title} count={rail.items.length}>
          {rail.items.map((event) => (
            <MediaTile
              key={event.id}
              title={event.title}
              // Arr art comes through Helprr's own image proxy, which
              // next/image will not optimize.
              imageUrl={posterFor(event)}
              landscapeUrl={backdropFor(event)}
              lines={[event.subtitle, airsAt(event.date)]}
              topLeftBadge={{ label: countdown(event.date), tone: 'green' }}
            />
          ))}
        </MediaRail>
      ))}
    </>
  );
}
