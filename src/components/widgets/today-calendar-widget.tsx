'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, CalendarDays } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, SectionHeader } from '@/components/widgets/shared';
import { toCachedImageSrc, isProtectedApiImageSrc } from '@/lib/image';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';

function getPoster(images: MediaImage[], serviceHint?: 'radarr' | 'sonarr'): string | null {
  const img = images.find((i) => i.coverType === 'poster');
  return toCachedImageSrc(img?.remoteUrl || img?.url || null, serviceHint);
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
          {events.slice(0, 4).map((event) => (
            <Link
              key={event.id}
              href={event.type === 'episode' ? `/series/${event.seriesId}` : `/movies/${event.movieId}`}
              className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2 hover:bg-muted/30 transition-colors"
            >
              <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${event.type === 'episode' ? 'bg-purple-500/80' : 'bg-blue-500/80'}`}>
                {event.type === 'episode' ? <Tv className="h-2.5 w-2.5 text-white" /> : <Film className="h-2.5 w-2.5 text-white" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{event.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{event.subtitle}</p>
              </div>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  // Large: poster carousel
  return (
    <div>
      <SectionHeader title="Today" href="/calendar" />
      <Carousel>
        {events.map((event) => {
          const poster = getPoster(event.images, event.type === 'movie' ? 'radarr' : 'sonarr');
          return (
            <Link
              key={event.id}
              href={event.type === 'episode' ? `/series/${event.seriesId}` : `/movies/${event.movieId}`}
              className="snap-start shrink-0 w-[110px] group"
            >
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
                {poster ? (
                  <Image
                    src={poster}
                    alt={event.title}
                    fill
                    sizes="110px"
                    className="object-cover transition-transform duration-300 group-active:scale-105"
                    unoptimized={isProtectedApiImageSrc(poster)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {event.type === 'episode'
                      ? <Tv className="h-6 w-6 text-muted-foreground/20" />
                      : <Film className="h-6 w-6 text-muted-foreground/20" />}
                  </div>
                )}
                <div className="absolute top-1.5 left-1.5">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${event.type === 'episode' ? 'bg-purple-500/80' : 'bg-blue-500/80'}`}>
                    {event.type === 'episode' ? <Tv className="h-2.5 w-2.5 text-white" /> : <Film className="h-2.5 w-2.5 text-white" />}
                  </span>
                </div>
              </div>
              <p className="text-[11px] font-medium truncate leading-tight">{event.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{event.subtitle}</p>
            </Link>
          );
        })}
      </Carousel>
    </div>
  );
}
