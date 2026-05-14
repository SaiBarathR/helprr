'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Clock, Check, CircleDashed } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, SectionHeader } from '@/components/widgets/shared';
import { formatDistanceToNowSafe } from '@/lib/format';
import { toCachedImageSrc, isProtectedApiImageSrc } from '@/lib/image';
import type { CalendarEvent, MediaImage } from '@/types';
import type { WidgetProps } from '@/lib/widgets/types';

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

const DAYS_OPTIONS = [7, 14, 30] as const;
const STORAGE_KEY = 'helprr-upcoming-days';

function getPoster(images: MediaImage[], serviceHint?: 'radarr' | 'sonarr'): string | null {
  const img = images.find((i) => i.coverType === 'poster');
  return toCachedImageSrc(img?.remoteUrl || img?.url || null, serviceHint);
}

function getStoredDays(): number {
  if (typeof window === 'undefined') return 14;
  const stored = localStorage.getItem(STORAGE_KEY);
  const parsed = stored ? parseInt(stored, 10) : NaN;
  return DAYS_OPTIONS.includes(parsed as typeof DAYS_OPTIONS[number]) ? parsed : 14;
}

export function UpcomingWidget({ size, refreshInterval }: WidgetProps) {
  const [days, setDays] = useState(() => getStoredDays());

  const fetchUpcoming = useCallback(async (): Promise<CalendarEvent[]> => {
    const res = await fetch(`/api/calendar?days=${days}`);
    if (!res.ok) return [];
    return res.json();
  }, [days]);

  const { data: upcoming, loading } = useWidgetData({ fetchFn: fetchUpcoming, refreshInterval });

  function handleDaysChange(newDays: number) {
    setDays(newDays);
    localStorage.setItem(STORAGE_KEY, String(newDays));
  }

  const daysSelector = (
    <Select value={String(days)} onValueChange={(v) => handleDaysChange(Number(v))}>
      <SelectTrigger
        size="sm"
        className="h-auto gap-1 rounded-md border-0 bg-muted/50 px-2 py-0.5 text-[10px] font-medium text-muted-foreground shadow-none hover:bg-muted [&_svg:not([class*='size-'])]:size-2.5"
      >
        <SelectValue />
      </SelectTrigger>
      <SelectContent align="end">
        {DAYS_OPTIONS.map((d) => (
          <SelectItem key={d} value={String(d)}>{d} days</SelectItem>
        ))}
      </SelectContent>
    </Select>
  );

  if (loading) {
    return (
      <div>
        <SectionHeader title="Upcoming" href="/calendar" badge={daysSelector} />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[170px] w-[110px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!upcoming || upcoming.length === 0) {
    return (
      <div>
        <SectionHeader title="Upcoming" href="/calendar" badge={daysSelector} />
        <div className="rounded-xl bg-card py-8 text-center">
          <p className="text-sm text-muted-foreground">Nothing upcoming</p>
        </div>
      </div>
    );
  }

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title="Upcoming" href="/calendar" badge={daysSelector} />
        <div className="space-y-1.5">
          {upcoming.slice(0, 4).map((event) => (
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
                <p className="text-[10px] text-muted-foreground truncate">
                  {event.subtitle} · {formatEventDate(event.date)} · {formatDistanceToNowSafe(event.date)}
                </p>
              </div>
              {event.hasFile ? (
                <span className="w-5 h-5 rounded-full bg-green-500/15 flex items-center justify-center shrink-0" title="Downloaded">
                  <Check className="h-3 w-3 text-green-500" />
                </span>
              ) : (
                <span className="w-5 h-5 rounded-full bg-muted flex items-center justify-center shrink-0" title="Not downloaded">
                  <CircleDashed className="h-3 w-3 text-muted-foreground" />
                </span>
              )}
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Upcoming" href="/calendar" badge={daysSelector} />
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
                  <div className="absolute top-1.5 left-1.5 right-1.5 flex items-start justify-between">
                    <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${event.type === 'episode' ? 'bg-purple-500/80' : 'bg-blue-500/80'}`}>
                      {event.type === 'episode' ? <Tv className="h-2.5 w-2.5 text-white" /> : <Film className="h-2.5 w-2.5 text-white" />}
                    </span>
                    {event.hasFile ? (
                      <span className="w-5 h-5 rounded-full bg-green-500/90 flex items-center justify-center">
                        <Check className="h-2.5 w-2.5 text-white" />
                      </span>
                    ) : (
                      <span className="w-5 h-5 rounded-full bg-black/60 backdrop-blur-sm flex items-center justify-center">
                        <CircleDashed className="h-2.5 w-2.5 text-white/70" />
                      </span>
                    )}
                  </div>
                </div>
                <p className="text-[11px] font-medium truncate leading-tight">{event.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{event.subtitle} · {formatDistanceToNowSafe(event.date)}</p>
                <p className="text-[9px] text-muted-foreground/70 tabular-nums truncate">{formatEventDate(event.date)}</p>
              </Link>
            );
          })}
        </Carousel>
    </div>
  );
}
