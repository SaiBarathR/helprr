'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Clock } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, SectionHeader } from '@/components/widgets/shared';
import { formatDistanceToNowSafe } from '@/lib/format';
import { toCachedImageSrc, isProtectedApiImageSrc } from '@/lib/image';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';

function getPoster(images: MediaImage[], serviceHint?: 'radarr' | 'sonarr'): string | null {
  const img = images.find((i) => i.coverType === 'poster');
  return toCachedImageSrc(img?.remoteUrl || img?.url || null, serviceHint);
}

async function fetchUpcoming(): Promise<CalendarEvent[]> {
  const res = await fetch('/api/calendar?days=14');
  if (!res.ok) return [];
  return res.json();
}

export function UpcomingWidget({ size, refreshInterval }: WidgetProps) {
  const { data: upcoming, loading } = useWidgetData({ fetchFn: fetchUpcoming, refreshInterval });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Upcoming" href="/calendar" />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[170px] w-[110px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Upcoming" href="/calendar" />
      {!upcoming || upcoming.length === 0 ? (
        <div className="rounded-xl bg-card py-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing upcoming</p>
        </div>
      ) : (
        <Carousel>
          {upcoming.slice(0, 12).map((event) => {
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
                        : <Film className="h-6 w-6 text-muted-foreground/20" />
                      }
                    </div>
                  )}
                  <div className="absolute bottom-1.5 left-1.5 right-1.5">
                    <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-black/70 backdrop-blur-sm text-[9px] text-white/90">
                      <Clock className="h-2 w-2" />
                      {formatDistanceToNowSafe(event.date)}
                    </span>
                  </div>
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
      )}
    </div>
  );
}
