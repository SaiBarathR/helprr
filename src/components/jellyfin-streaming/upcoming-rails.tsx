'use client';

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { FadeInImage } from '@/components/media/fade-in-image';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import { cn } from '@/lib/utils';
import type { CalendarEvent } from '@/types';

const DAY_MS = 86_400_000;
const EPISODE_WINDOW_DAYS = 7;
const MONTHS_AHEAD = 3;

/** Season premieres are the signal for "a new season is coming". */
const PREMIERE_RE = /^S(\d+)E0*1\b/i;

function posterFor(event: CalendarEvent): string | null {
  const hint: ImageServiceHint = event.type === 'movie' ? 'radarr' : event.type === 'album' ? 'lidarr' : 'sonarr';
  const image = event.images?.find((i) => i.coverType === 'poster')
    ?? event.images?.find((i) => i.coverType === 'cover')
    ?? event.images?.find((i) => i.coverType === 'fanart');
  return toCachedImageSrc(image?.remoteUrl || image?.url || null, hint);
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
        <section key={rail.key} className="space-y-2">
          <h2 className="text-base font-semibold tracking-tight">{rail.title}</h2>
          <div className="animate-rail-in flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-[var(--main-pad-x)] px-[var(--main-pad-x)]">
            {rail.items.map((event) => {
              const poster = posterFor(event);
              return (
                <div
                  key={event.id}
                  className="group relative w-[110px] shrink-0 sm:w-[140px] md:w-[150px] lg:w-[164px] xl:w-[180px] 2xl:w-[196px]"
                >
                  <div className={cn('relative aspect-2/3 overflow-hidden rounded-xl border border-border/40 bg-muted/60')}>
                    {poster ? (
                      <FadeInImage
                        src={poster}
                        alt={event.title}
                        fill
                        sizes="196px"
                        // Arr art comes through Helprr's own image proxy, which
                        // next/image will not optimize.
                        unoptimized
                        className="object-cover"
                      />
                    ) : (
                      <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
                        {event.title}
                      </div>
                    )}
                    <span className="absolute top-2 left-2 z-20 rounded-md bg-[var(--hpr-green)] px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--hpr-ink)] uppercase">
                      {countdown(event.date)}
                    </span>
                  </div>
                  <p className="mt-2 truncate text-sm font-medium">{event.title}</p>
                  <p className="truncate text-[11px] text-muted-foreground">
                    {event.subtitle || new Date(event.date).toLocaleDateString()}
                  </p>
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </>
  );
}
