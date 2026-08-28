'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { FadeInImage } from '@/components/media/fade-in-image';
import { toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import type { CalendarEvent } from '@/types';
import { cn } from '@/lib/utils';

const MONTHS_AHEAD = 3;

type TabId = 'coming' | 'watching';

const TABS: Array<{ id: TabId; label: string; emoji: string }> = [
  { id: 'coming', label: 'Coming Soon', emoji: '🍿' },
  { id: 'watching', label: 'Everyone’s Watching', emoji: '🔥' },
];

function hintFor(event: CalendarEvent): ImageServiceHint {
  return event.type === 'movie' ? 'radarr' : event.type === 'album' ? 'lidarr' : 'sonarr';
}

/** 16:9 first — a feed card is a wide frame, never a poster. */
function artFor(event: CalendarEvent): string | null {
  const image = event.images?.find((i) => i.coverType === 'fanart')
    ?? event.images?.find((i) => i.coverType === 'screenshot')
    ?? event.images?.find((i) => i.coverType === 'poster');
  return toCachedImageSrc(image?.remoteUrl || image?.url || null, hintFor(event));
}

/**
 * The headline the site writes above each card — "New episode coming on
 * Saturday" — rather than a bare countdown chip.
 */
function headline(event: CalendarEvent): string {
  const date = new Date(event.date);
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const noun = event.type === 'movie' ? 'Coming' : 'New episode coming';
  if (days <= 0) return `${noun} today`;
  if (days === 1) return `${noun} tomorrow`;
  if (days < 7) return `${noun} on ${date.toLocaleDateString([], { weekday: 'long' })}`;
  return `${noun} ${date.toLocaleDateString([], { day: 'numeric', month: 'long' })}`;
}

/**
 * New & Hot: emoji tab pills over a vertical feed of large cards, each with a
 * date in the gutter — not the horizontal rails this page used to be.
 *
 * The site's third tab is Games, which Helprr has no equivalent of, and its
 * cards carry a "Remind Me" button that would need a real reminder behind it;
 * neither is faked here.
 */
export function NewAndHot({ railsFallback }: { railsFallback: React.ReactNode }) {
  const [tab, setTab] = useState<TabId>('coming');
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
    enabled: canSeeCalendar && tab === 'coming',
    staleTime: 5 * 60_000,
  });

  const events = useMemo(
    () => (query.data ?? [])
      .filter((event) => new Date(event.date).getTime() >= range.startMs)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 40),
    [query.data, range.startMs],
  );

  return (
    <div className="space-y-6 pb-28">
      <nav aria-label="New & Hot sections" className="flex items-center gap-2 overflow-x-auto pt-1 scrollbar-hide">
        {TABS.map((entry) => (
          <button
            key={entry.id}
            type="button"
            onClick={() => setTab(entry.id)}
            aria-pressed={tab === entry.id}
            className={cn(
              'flex shrink-0 items-center gap-2 rounded-full border px-4 py-2 text-[15px] font-medium whitespace-nowrap transition-colors',
              tab === entry.id
                ? 'border-white bg-white text-black'
                : 'border-white/25 bg-white/5 text-white/85',
            )}
          >
            <span aria-hidden>{entry.emoji}</span>
            {entry.label}
          </button>
        ))}
      </nav>

      {tab === 'watching' ? (
        railsFallback
      ) : !canSeeCalendar ? (
        <p className="text-sm text-muted-foreground">You don&rsquo;t have access to the calendar.</p>
      ) : events.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing scheduled in the next {MONTHS_AHEAD} months.</p>
      ) : (
        <ul className="space-y-8">
          {events.map((event) => (
            <FeedCard key={event.id} event={event} />
          ))}
        </ul>
      )}
    </div>
  );
}

function FeedCard({ event }: { event: CalendarEvent }) {
  const art = artFor(event);
  const date = new Date(event.date);
  const href = event.type === 'movie' && event.movieId
    ? `/movies/${event.movieId}`
    : event.seriesId ? `/series/${event.seriesId}` : null;

  const body = (
    <>
      <div className="relative aspect-video w-full overflow-hidden rounded bg-white/5">
        {art && <FadeInImage src={art} alt="" fill sizes="(min-width: 768px) 620px, 100vw" unoptimized className="object-cover" />}
        {/* The site rules the foot of every card in its brand red. */}
        <span aria-hidden className="absolute inset-x-0 bottom-0 h-[3px] bg-[#e50914]" />
      </div>
      <p className="mt-3 text-lg font-bold text-white">{event.title}</p>
      <p className="mt-0.5 text-[15px] font-medium text-white/90">{headline(event)}</p>
      {event.subtitle && <p className="mt-1 text-sm text-[#b3b3b3]">{event.subtitle}</p>}
    </>
  );

  return (
    <li className="flex gap-4">
      {/* Date gutter, as the app runs down the left of this screen. */}
      <div className="w-10 shrink-0 pt-1 text-center">
        <p className="text-[11px] font-semibold tracking-wide text-[#b3b3b3] uppercase">
          {date.toLocaleDateString([], { month: 'short' })}
        </p>
        <p className="text-2xl font-bold text-white">{date.getDate()}</p>
      </div>
      <div className="min-w-0 flex-1 md:max-w-[620px]">
        {href ? <Link href={href}>{body}</Link> : body}
      </div>
    </li>
  );
}
