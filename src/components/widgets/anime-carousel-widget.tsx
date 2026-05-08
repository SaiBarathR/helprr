'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { PlayCircle, Star } from 'lucide-react';
import { useWidgetData } from '@/lib/widgets/use-widget-data';
import { Carousel, EditModePlaceholder, SectionHeader } from '@/components/widgets/shared';
import { Skeleton } from '@/components/ui/skeleton';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AnimeCarouselId } from '@/lib/anime-carousel-config';
import type { AniListMediaListCollection, AniListMediaListEntry } from '@/lib/anilist-mutations';
import type { AniListMediaSeason, AniListListItem } from '@/types/anilist';

interface SeasonWindow {
  season: AniListMediaSeason;
  year: number;
}

interface HomeData {
  currentSeason: SeasonWindow;
  nextSeasonInfo: SeasonWindow;
  trending: AniListListItem[];
  season: AniListListItem[];
  nextSeason: AniListListItem[];
  popular: AniListListItem[];
  top: AniListListItem[];
}

interface AnimeCarouselWidgetProps {
  carouselId: AnimeCarouselId;
  size: 'small' | 'medium' | 'large';
  refreshInterval: number;
  editMode?: boolean;
}

function flattenEntries(collection: AniListMediaListCollection): AniListMediaListEntry[] {
  const seen = new Set<number>();
  const result: AniListMediaListEntry[] = [];
  for (const list of collection.lists) {
    for (const entry of list.entries) {
      if (seen.has(entry.id)) continue;
      seen.add(entry.id);
      result.push(entry);
    }
  }
  return result;
}

function entryToRailItem(entry: AniListMediaListEntry) {
  const media = entry.media;
  const title = media.title.english || media.title.romaji || media.title.native || `#${media.id}`;
  const cover = media.coverImage?.large || media.coverImage?.medium || media.coverImage?.extraLarge || null;
  return {
    id: media.id,
    title,
    coverImage: cover,
    format: (media.format as string) ?? null,
    averageScore: media.averageScore,
    episodes: media.episodes ?? null,
    seasonYear: media.seasonYear ?? null,
  };
}

function itemToRailItem(item: AniListListItem) {
  const title = item.title || item.titleRomaji || item.titleNative || `#${item.id}`;
  const cover = item.coverImage || null;
  return {
    id: item.id,
    title,
    coverImage: cover,
    format: (item.format as string) ?? null,
    averageScore: item.averageScore,
    episodes: item.episodes ?? null,
    seasonYear: item.seasonYear ?? null,
  };
}

let globalHomeDataPromise: Promise<HomeData> | null = null;
let globalHomeDataPromiseTime = 0;

async function fetchHomeDataCached() {
  const now = Date.now();
  if (globalHomeDataPromise && now - globalHomeDataPromiseTime < 5 * 60 * 1000) {
    return globalHomeDataPromise;
  }
  globalHomeDataPromiseTime = now;
  globalHomeDataPromise = fetch('/api/anime/home?perPage=15')
    .then((res) => {
      if (!res.ok) throw new Error('Failed to fetch anime home data');
      return res.json() as Promise<HomeData>;
    })
    .catch((error) => {
      globalHomeDataPromise = null;
      globalHomeDataPromiseTime = 0;
      throw error;
    });
  return globalHomeDataPromise;
}

export function AnimeCarouselWidget({ carouselId, size, refreshInterval, editMode }: AnimeCarouselWidgetProps) {
  const safeInterval = Math.max(refreshInterval, 5 * 60 * 1000);

  const requiresViewer = carouselId === 'continueWatching' || carouselId === 'planToWatch';
  const [anilistViewerConnected, setAnilistViewerConnected] = useState<boolean | null>(null);
  const viewerConnected = requiresViewer ? anilistViewerConnected : true;

  useEffect(() => {
    if (!requiresViewer) return;
    fetch('/api/anilist/viewer')
      .then((res) => res.json())
      .then((data) => setAnilistViewerConnected(!!data.connected))
      .catch(() => setAnilistViewerConnected(false));
  }, [requiresViewer]);

  const { data: homeData, loading: homeLoading, error: homeError } = useWidgetData<HomeData>({
    fetchFn: fetchHomeDataCached,
    refreshInterval: safeInterval,
    enabled: !requiresViewer && viewerConnected === true,
  });

  const { data: listData, loading: listLoading, error: listError } = useWidgetData<AniListMediaListEntry[]>({
    fetchFn: async () => {
      const status = carouselId === 'continueWatching' ? 'CURRENT' : 'PLANNING';
      const res = await fetch(`/api/anilist/library?type=ANIME&status=${status}`);
      if (!res.ok) throw new Error(`Failed to fetch ${status} list`);
      const json = await res.json();
      return flattenEntries(json.collection);
    },
    refreshInterval: safeInterval,
    enabled: requiresViewer && viewerConnected === true,
  });

  if (viewerConnected === false) {
    return (
      <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-muted-foreground text-center">
        Please connect your AniList account in Settings.
      </div>
    );
  }

  const loading = requiresViewer ? listLoading : homeLoading;
  const error = requiresViewer ? listError : homeError;

  let title = '';
  let viewAllHref = '';

  if (carouselId === 'continueWatching') {
    title = 'Continue Watching';
    viewAllHref = '/anime/library?status=CURRENT';
  } else if (carouselId === 'planToWatch') {
    title = 'Plan to Watch';
    viewAllHref = '/anime/library?status=PLANNING';
  } else if (carouselId === 'trending') {
    title = 'Trending Now';
    viewAllHref = '/anime/explore?sort=trending';
  } else if (carouselId === 'popularThisSeason') {
    title = 'Popular This Season';
    viewAllHref = homeData?.currentSeason
      ? `/anime/explore?sort=seasonal&season=${homeData.currentSeason.season}&year=${homeData.currentSeason.year}`
      : '/anime/explore?sort=seasonal';
  } else if (carouselId === 'upcomingNextSeason') {
    title = 'Upcoming Next Season';
    viewAllHref = homeData?.nextSeasonInfo
      ? `/anime/explore?sort=seasonal&season=${homeData.nextSeasonInfo.season}&year=${homeData.nextSeasonInfo.year}`
      : '/anime/explore?sort=seasonal';
  } else if (carouselId === 'allTimePopular') {
    title = 'All Time Popular';
    viewAllHref = '/anime/explore?sort=popularity';
  } else if (carouselId === 'top100') {
    title = 'Top 100';
    viewAllHref = '/anime/explore?sort=score';
  }

  if (loading && !homeData && !listData) {
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

  if (error) {
    return (
      <div className="flex h-full items-center justify-center bg-card p-4 rounded-xl text-xs text-red-500">
        {error}
      </div>
    );
  }

  let items: ReturnType<typeof itemToRailItem>[] = [];

  if (carouselId === 'continueWatching' || carouselId === 'planToWatch') {
    items = (listData ?? []).map(entryToRailItem);
  } else if (homeData) {
    switch (carouselId) {
      case 'trending': items = homeData.trending.map(itemToRailItem); break;
      case 'popularThisSeason': items = homeData.season.map(itemToRailItem); break;
      case 'upcomingNextSeason': items = homeData.nextSeason.map(itemToRailItem); break;
      case 'allTimePopular': items = homeData.popular.map(itemToRailItem); break;
      case 'top100': items = homeData.top.map(itemToRailItem); break;
    }
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
            const isManga = item.format === 'MANGA' || item.format === 'NOVEL' || item.format === 'ONE_SHOT';
            const href = isManga ? `/anime/manga/${item.id}` : `/anime/${item.id}`;
            const metadata: string[] = [];
            if (item.format) metadata.push(item.format.replace('_', ' '));
            if (item.episodes != null) {
              metadata.push(`${item.episodes} eps`);
            }
            const subtitle = metadata.join(' · ');
            return (
              <Link
                key={item.id}
                href={href}
                className="flex items-center gap-2.5 rounded-xl bg-card px-3 py-2.5 hover:bg-muted/30 transition-colors"
              >
                <span className="w-5 h-5 rounded-md flex items-center justify-center shrink-0 bg-pink-500/80">
                  <PlayCircle className="h-2.5 w-2.5 text-white" />
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-medium truncate">{item.title}</p>
                  <p className="text-[10px] text-muted-foreground truncate">{subtitle}</p>
                </div>
              </Link>
            );
          })}
        </div>
      </div>
    );
  }

  // Large size uses Carousel
  return (
    <div>
      <SectionHeader title={title} href={viewAllHref} />
      <Carousel>
        {items.map((item) => {
          const imgSrc = item.coverImage
            ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
            : null;
          const isManga = item.format === 'MANGA' || item.format === 'NOVEL' || item.format === 'ONE_SHOT';
          const href = isManga ? `/anime/manga/${item.id}` : `/anime/${item.id}`;
          const metadata: string[] = [];
          if (item.format) metadata.push(item.format.replace('_', ' '));
          if (item.episodes != null) {
            metadata.push(`${item.episodes} eps`);
          }

          return (
            <Link
              key={item.id}
              href={href}
              className="snap-start shrink-0 w-[110px] group"
            >
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted mb-1.5 shadow-sm border border-border/30 group-hover:border-primary/40 transition-colors">
                {imgSrc ? (
                  <Image
                    src={imgSrc}
                    alt={item.title}
                    fill
                    sizes="110px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized={isProtectedApiImageSrc(imgSrc)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                    {item.title}
                  </div>
                )}
                {item.averageScore != null && item.averageScore > 0 && (
                  <div className="absolute right-1">
                    <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md bg-black/60 backdrop-blur-sm text-[9px] text-white">
                      <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                      {item.averageScore}%
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
