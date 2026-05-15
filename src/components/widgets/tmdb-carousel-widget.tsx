'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Star, CheckCircle2 } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
import { Skeleton } from '@/components/ui/skeleton';
import type { DiscoverItem, DiscoverResponse, DiscoverSection } from '@/types';
import type { TmdbCarouselId } from '@/lib/tmdb-carousel-config';
import { TMDB_CAROUSEL_MAP } from '@/lib/tmdb-carousel-config';

interface TmdbCarouselWidgetProps {
  carouselId: TmdbCarouselId;
  size: 'small' | 'medium' | 'large';
  refreshInterval: number;
  editMode?: boolean;
}

const CLIENT_CACHE_MS = 5 * 60 * 1000;

let sectionsPromise: Promise<DiscoverResponse> | null = null;
let sectionsPromiseTime = 0;

async function fetchSectionsCached(): Promise<DiscoverResponse> {
  const now = Date.now();
  if (sectionsPromise && now - sectionsPromiseTime < CLIENT_CACHE_MS) {
    return sectionsPromise;
  }
  sectionsPromiseTime = now;
  sectionsPromise = fetch('/api/discover?mode=sections')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch TMDB sections');
      return res.json() as Promise<DiscoverResponse>;
    })
    .catch((err) => {
      sectionsPromise = null;
      sectionsPromiseTime = 0;
      throw err;
    });
  return sectionsPromise;
}

function detailHref(item: DiscoverItem): string {
  return item.mediaType === 'movie' ? `/discover/movie/${item.tmdbId}` : `/discover/tv/${item.tmdbId}`;
}

export function TmdbCarouselWidget({ carouselId, size, refreshInterval, editMode }: TmdbCarouselWidgetProps) {
  const safeInterval = Math.max(refreshInterval, CLIENT_CACHE_MS);
  const config = TMDB_CAROUSEL_MAP[carouselId];

  const { data, loading, error } = useWidgetData<DiscoverResponse>({
    fetchFn: fetchSectionsCached,
    refreshInterval: safeInterval,
  });

  const title = config.label;
  const viewAllHref = `/discover?section=${config.sectionKey}`;

  if (loading && !data) {
    return (
      <div>
        <SectionHeader title={title} href={viewAllHref} />
        {size === 'medium' ? (
          <div className="flex flex-col gap-1.5">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-[44px] w-full rounded-xl shrink-0" />
            ))}
          </div>
        ) : (
          <div className="flex gap-3 overflow-hidden">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-[170px] w-[110px] rounded-xl shrink-0" />
            ))}
          </div>
        )}
      </div>
    );
  }

  const section = data?.sections?.find((s): s is DiscoverSection => s.key === config.sectionKey);
  const items = (section?.items as DiscoverItem[] | undefined) ?? [];

  if (error && items.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-red-500">
        {error}
      </div>
    );
  }

  if (items.length === 0) {
    return editMode ? <EditModePlaceholder title={title} message="No items found" /> : null;
  }

  if (size === 'medium') {
    return (
      <div>
        <SectionHeader title={title} href={viewAllHref} />
        <div className="space-y-1.5">
          {items.slice(0, 4).map((item) => {
            const Icon = item.mediaType === 'movie' ? Film : Tv;
            const badgeColor = item.mediaType === 'movie' ? 'bg-sky-500/80' : 'bg-violet-500/80';
            const metadata: string[] = [];
            if (item.year != null) metadata.push(String(item.year));
            if (item.rating > 0) metadata.push(`${item.rating.toFixed(1)}★`);
            return (
              <Link
                key={`${item.mediaType}-${item.tmdbId}`}
                href={detailHref(item)}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <span className={`w-5 h-5 rounded-md flex items-center justify-center shrink-0 ${badgeColor}`}>
                  <Icon className="h-2.5 w-2.5 text-white" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{metadata.join(' · ')}</p>
                </div>
                {item.library?.exists && (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                )}
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div>
      <SectionHeader title={title} href={viewAllHref} />
      <Carousel>
        {items.map((item) => {
          const metadata: string[] = [];
          if (item.year != null) metadata.push(String(item.year));
          if (item.mediaType === 'tv') metadata.push('TV');
          return (
            <Link
              key={`${item.mediaType}-${item.tmdbId}`}
              href={detailHref(item)}
              className="snap-start shrink-0 w-[110px] group"
            >
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm border border-border/30 group-hover:border-primary/40 transition-colors">
                {item.posterPath ? (
                  <Image
                    src={item.posterPath}
                    alt={item.title}
                    fill
                    sizes="110px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                    {item.title}
                  </div>
                )}
                {item.library?.exists && (
                  <div className="absolute left-1 top-1">
                    <span className="inline-flex items-center justify-center h-4 w-4 rounded-full bg-emerald-500 text-white">
                      <CheckCircle2 className="h-3 w-3" />
                    </span>
                  </div>
                )}
                {item.rating > 0 && (
                  <div className="absolute right-1 top-1">
                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] text-white">
                      <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                      {item.rating.toFixed(1)}
                    </span>
                  </div>
                )}
              </div>
              <p className="text-[11px] font-medium truncate leading-tight">{item.title}</p>
              <p className="text-[10px] text-muted-foreground truncate">{metadata.join(' · ')}</p>
            </Link>
          );
        })}
      </Carousel>
    </div>
  );
}
