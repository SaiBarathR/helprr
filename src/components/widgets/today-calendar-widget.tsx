'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, CalendarDays, Clock, CheckCircle2 } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { SectionHeader } from '@/components/widgets/shared';
import { toCachedImageSrc, isProtectedApiImageSrc } from '@/lib/image';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';

function getPoster(images: MediaImage[], serviceHint?: 'radarr' | 'sonarr'): string | null {
  const img = images.find((i) => i.coverType === 'poster');
  return toCachedImageSrc(img?.remoteUrl || img?.url || null, serviceHint);
}

function formatTime(dateStr: string): string {
  const date = new Date(dateStr);
  if (!Number.isFinite(date.getTime())) return '';
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function isInPast(dateStr: string): boolean {
  return new Date(dateStr).getTime() < Date.now();
}

async function fetchToday(): Promise<CalendarEvent[]> {
  const res = await fetch('/api/calendar?days=1&fullDay=true');
  if (!res.ok) return [];
  return res.json();
}

export function TodayCalendarWidget({ size, refreshInterval }: WidgetProps) {
  const { data: events, loading } = useWidgetData({ fetchFn: fetchToday, refreshInterval });

  if (loading) {
    return (
      <div className="rounded-xl bg-card p-3">
        <Skeleton className="h-5 w-20 mb-2" />
        <Skeleton className="h-4 w-32" />
      </div>
    );
  }

  if (size === 'small') {
    return (
      <Link
        href="/calendar"
        className="rounded-xl bg-card p-3 flex items-center gap-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
      >
        <CalendarDays className="h-4 w-4 text-primary" />
        <div>
          <span className="text-lg font-bold tabular-nums">{events?.length || 0}</span>
          <span className="text-xs text-muted-foreground ml-1">today</span>
        </div>
      </Link>
    );
  }

  if (!events || events.length === 0) {
    return (
      <div>
        <SectionHeader title="Today" href="/calendar" />
        <div className="rounded-xl bg-card py-6 text-center">
          <CalendarDays className="h-5 w-5 text-muted-foreground/30 mx-auto mb-1" />
          <p className="text-xs text-muted-foreground">Nothing airing today</p>
        </div>
      </div>
    );
  }

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title="Today" href="/calendar" />
        <div className="space-y-1.5">
          {events.slice(0, 4).map((event) => {
            const time = formatTime(event.date);
            const past = isInPast(event.date);
            return (
              <Link
                key={event.id}
                href={event.type === 'episode' ? `/series/${event.seriesId}` : `/movies/${event.movieId}`}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${event.type === 'episode' ? 'bg-purple-500/80' : 'bg-blue-500/80'}`}>
                  {event.type === 'episode' ? <Tv className="h-2.5 w-2.5 text-white" /> : <Film className="h-2.5 w-2.5 text-white" />}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{event.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{event.subtitle}</p>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {event.hasFile && <CheckCircle2 className="h-3 w-3 text-green-400" />}
                  {time && (
                    <span className={`text-[10px] tabular-nums font-medium ${past ? 'text-muted-foreground' : 'text-primary'}`}>
                      {time}
                    </span>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // Large: timeline-style list with posters
  return (
    <div>
      <SectionHeader title="Today" href="/calendar" />
      <div className="space-y-3">
        {events.map((event) => {
          const poster = getPoster(event.images, event.type === 'movie' ? 'radarr' : 'sonarr');
          const time = formatTime(event.date);
          return (
            <Link
              key={event.id}
              href={event.type === 'episode' ? `/series/${event.seriesId}` : `/movies/${event.movieId}`}
              className="flex items-start gap-3 rounded-xl bg-card p-2 hover:bg-muted/30 active:bg-muted/50 transition-colors group"
            >
              {/* Time column */}
              {/* <div className="w-9 shrink-0 text-center">
                {time ? (
                  <span className={`text-xs tabular-nums font-semibold ${past ? 'text-muted-foreground' : 'text-primary'}`}>
                    {time}
                  </span>
                ) : (
                  <Clock className="h-3.5 w-3.5 text-muted-foreground mx-auto" />
                )}
              </div> */}
              {/* Poster */}
              <div className="relative w-12 h-[72px] rounded-lg overflow-hidden bg-muted shrink-0">
                {poster ? (
                  <Image
                    src={poster}
                    alt={event.title}
                    fill
                    sizes="36px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(poster)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {event.type === 'episode'
                      ? <Tv className="h-3.5 w-3.5 text-muted-foreground/20" />
                      : <Film className="h-3.5 w-3.5 text-muted-foreground/20" />}
                  </div>
                )}
              </div>
              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{event.title}</p>
                <p className="text-xs text-muted-foreground wrap-break-words">{event.subtitle}</p>
                <p className="text-xs text-muted-foreground truncate">{time}</p>
              </div>
              {/* Status */}
              <div className="shrink-0 pr-1">
                {event.hasFile ? (
                  <CheckCircle2 className="h-4 w-4 text-green-400" />
                ) : (
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${event.type === 'episode' ? 'bg-purple-500/80' : 'bg-blue-500/80'}`}>
                    {event.type === 'episode' ? <Tv className="h-2.5 w-2.5 text-white" /> : <Film className="h-2.5 w-2.5 text-white" />}
                  </span>
                )}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
