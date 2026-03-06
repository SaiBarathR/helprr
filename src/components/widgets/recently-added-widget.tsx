'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv } from 'lucide-react';
import { Skeleton } from '@/components/ui/skeleton';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
import { formatDistanceToNowSafe } from '@/lib/format';
import { toCachedImageSrc, isProtectedApiImageSrc } from '@/lib/image';
import type { WidgetProps } from '@/lib/widgets/types';

interface RecentItem {
  id: string;
  title: string;
  subtitle: string;
  type: 'movie' | 'episode';
  date: string;
  poster: string | null;
  href: string;
}

async function fetchRecent(): Promise<RecentItem[]> {
  const res = await fetch('/api/activity/recent?limit=30');
  if (!res.ok) return [];
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function RecentlyAddedWidget({ size, refreshInterval, editMode = false }: WidgetProps) {
  const { data: recentlyAdded, loading } = useWidgetData({ fetchFn: fetchRecent, refreshInterval });

  if (loading) {
    return (
      <div>
        <SectionHeader title="Recently Added" href="/activity/history" />
        <div className="flex gap-3 overflow-hidden">
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-[170px] w-[110px] rounded-xl shrink-0" />
          ))}
        </div>
      </div>
    );
  }

  if (!recentlyAdded || recentlyAdded.length === 0) {
    return editMode ? <EditModePlaceholder title="Recently Added" message="No recent imports" /> : null;
  }

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title="Recently Added" href="/activity/history" />
        <div className="space-y-1.5">
          {recentlyAdded.slice(0, 4).map((item) => (
            <Link
              key={item.id}
              href={item.href}
              className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors"
            >
              <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${item.type === 'movie' ? 'bg-blue-500/80' : 'bg-purple-500/80'}`}>
                {item.type === 'movie' ? <Film className="h-2.5 w-2.5 text-white" /> : <Tv className="h-2.5 w-2.5 text-white" />}
              </span>
              <div className="flex-1 min-w-0">
                <p className="text-xs font-medium truncate">{item.title}</p>
                <p className="text-[10px] text-muted-foreground truncate">{item.subtitle}</p>
              </div>
              <span className="text-[10px] tabular-nums text-muted-foreground shrink-0">
                {formatDistanceToNowSafe(item.date)}
              </span>
            </Link>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title="Recently Added" href="/activity/history" />
      <Carousel>
        {recentlyAdded.map((item) => {
          const posterSrc = toCachedImageSrc(item.poster, item.type === 'movie' ? 'radarr' : 'sonarr') || item.poster;

          return (
            <Link
              key={item.id}
              href={item.href}
              className="snap-start shrink-0 w-[110px] group"
            >
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm">
                {posterSrc ? (
                  <Image
                    src={posterSrc}
                    alt={item.title}
                    fill
                    sizes="110px"
                    className="object-cover transition-transform duration-300 group-active:scale-105"
                    unoptimized={isProtectedApiImageSrc(posterSrc)}
                  />
                ) : (
                  <div className="w-full h-full flex items-center justify-center">
                    {item.type === 'movie'
                      ? <Film className="h-6 w-6 text-muted-foreground/20" />
                      : <Tv className="h-6 w-6 text-muted-foreground/20" />
                    }
                  </div>
                )}
                <div className="absolute top-1.5 left-1.5">
                  <span className={`inline-flex items-center justify-center w-5 h-5 rounded-md ${item.type === 'movie' ? 'bg-blue-500/80' : 'bg-purple-500/80'}`}>
                    {item.type === 'movie' ? <Film className="h-2.5 w-2.5 text-white" /> : <Tv className="h-2.5 w-2.5 text-white" />}
                  </span>
                </div>
              </div>
              <p className="text-[11px] font-medium truncate leading-tight">{item.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{item.subtitle || formatDistanceToNowSafe(item.date)}</p>
            </Link>
          );
        })}
      </Carousel>
    </div>
  );
}
