'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Search, Star, Sparkles, CalendarClock } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useUIStore } from '@/lib/store';
import {
  type AnimeCarouselId,
  reconcileAnimeCarouselOrder,
} from '@/lib/anime-carousel-config';
import type { AniListMediaSeason, AniListListItem } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';
import type {
  AniListMediaListCollection,
  AniListMediaListEntry,
} from '@/lib/anilist-mutations';

type AnimeItemWithLibrary = AniListListItem & { library?: DiscoverLibraryStatus };
interface SeasonWindow {
  season: AniListMediaSeason;
  year: number;
}

interface HomeData {
  currentSeason: SeasonWindow;
  nextSeasonInfo: SeasonWindow;
  trending: AnimeItemWithLibrary[];
  season: AnimeItemWithLibrary[];
  nextSeason: AnimeItemWithLibrary[];
  popular: AnimeItemWithLibrary[];
  top: AnimeItemWithLibrary[];
}

function getHomePerPageFromWidth(width: number): number {
  if (width >= 1536) return 40;
  if (width >= 768) return 30;
  return 10;
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
    format: (media.format as never) ?? null,
    averageScore: media.averageScore,
    episodes: media.episodes ?? null,
    seasonYear: media.seasonYear ?? null,
  };
}

function HeroBanner({ anime }: { anime: AnimeItemWithLibrary }) {
  const bannerSrc = anime.bannerImage
    ? toCachedImageSrc(anime.bannerImage, 'anilist') || anime.bannerImage
    : null;
  const coverSrc = anime.coverImage
    ? toCachedImageSrc(anime.coverImage, 'anilist') || anime.coverImage
    : null;

  const accentColor = anime.coverImageColor || '#6366f1';

  return (
    <Link href={`/anime/${anime.id}`} className="block -mx-2 -mt-3">
      <div className="relative h-[280px] overflow-hidden">
        {bannerSrc ? (
          <Image
            src={bannerSrc}
            alt={anime.title}
            fill
            className="object-cover animate-hero-zoom"
            priority
            unoptimized={isProtectedApiImageSrc(bannerSrc)}
          />
        ) : coverSrc ? (
          <Image
            src={coverSrc}
            alt={anime.title}
            fill
            className="object-cover blur-2xl scale-125 animate-hero-zoom"
            priority
            unoptimized={isProtectedApiImageSrc(coverSrc)}
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: `linear-gradient(135deg, ${accentColor}40, transparent 60%)` }}
        />
        {/* Content */}
        <div className="absolute bottom-0 left-0 right-0 p-4 flex flex-col gap-1.5">
          <h1 className="text-xl font-bold leading-tight line-clamp-2 drop-shadow-lg">{anime.title}</h1>
          <div className="flex items-center gap-2 flex-wrap">
            {anime.averageScore != null && anime.averageScore > 0 && (
              <Badge className="bg-black/50 text-white text-[10px] gap-0.5 backdrop-blur-sm">
                <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                {anime.averageScore}%
              </Badge>
            )}
            {anime.format && (
              <Badge variant="outline" className="text-[10px] border-white/30 text-white backdrop-blur-sm">
                {anime.format.replace('_', ' ')}
              </Badge>
            )}
            {anime.genres.slice(0, 3).map((genre) => (
              <Badge key={genre} variant="outline" className="text-[10px] border-white/30 text-white backdrop-blur-sm">
                {genre}
              </Badge>
            ))}
          </div>
        </div>
      </div>
    </Link>
  );
}

interface ViewerSummary {
  connected: boolean;
  user?: { name: string };
}

export default function AnimeHomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewer, setViewer] = useState<ViewerSummary | null>(null);
  const [watchingEntries, setWatchingEntries] = useState<AniListMediaListEntry[]>([]);
  const [planningEntries, setPlanningEntries] = useState<AniListMediaListEntry[]>([]);

  useEffect(() => {
    async function fetchHome() {
      try {
        const perPage = getHomePerPageFromWidth(window.innerWidth);
        const params = new URLSearchParams({ perPage: String(perPage) });
        const res = await fetch(`/api/anime/home?${params.toString()}`);
        if (!res.ok) throw new Error('Failed to fetch home data');
        const json = await res.json();
        setData(json);
      } catch (err) {
        console.error(err);
        setError('Failed to load anime');
      } finally {
        setLoading(false);
      }
    }
    fetchHome();
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function loadViewer() {
      try {
        const res = await fetch('/api/anilist/viewer');
        if (!res.ok) {
          if (!cancelled) setViewer({ connected: false });
          return;
        }
        const json = await res.json();
        if (cancelled) return;
        setViewer({ connected: !!json.connected, user: json.user });

        if (!json.connected) {
          setWatchingEntries([]);
          setPlanningEntries([]);
          return;
        }

        const [watchingRes, planningRes] = await Promise.allSettled([
          fetch('/api/anilist/library?type=ANIME&status=CURRENT'),
          fetch('/api/anilist/library?type=ANIME&status=PLANNING'),
        ]);

        if (!cancelled && watchingRes.status === 'fulfilled' && watchingRes.value.ok) {
          const lib = (await watchingRes.value.json()) as { collection: AniListMediaListCollection };
          setWatchingEntries(flattenEntries(lib.collection));
        }
        if (!cancelled && planningRes.status === 'fulfilled' && planningRes.value.ok) {
          const lib = (await planningRes.value.json()) as { collection: AniListMediaListCollection };
          setPlanningEntries(flattenEntries(lib.collection));
        }
      } catch {
        if (!cancelled) setViewer({ connected: false });
      }
    }
    void loadViewer();
    return () => {
      cancelled = true;
    };
  }, []);

  const animeCarouselOrder = useUIStore((s) => s.animeCarouselOrder);
  const disabledAnimeCarousels = useUIStore((s) => s.disabledAnimeCarousels);

  const heroAnime = data?.trending?.[0] ?? null;
  const trendingItems = data?.trending?.slice(1) ?? [];
  const currentSeason = data?.currentSeason;
  const nextSeasonInfo = data?.nextSeasonInfo;

  const watchingItems = useMemo(() => watchingEntries.map(entryToRailItem), [watchingEntries]);
  const planningItems = useMemo(() => planningEntries.map(entryToRailItem), [planningEntries]);

  const disabledSet = useMemo(() => new Set(disabledAnimeCarousels), [disabledAnimeCarousels]);
  const orderedCarouselIds = useMemo(
    () => reconcileAnimeCarouselOrder(animeCarouselOrder),
    [animeCarouselOrder]
  );

  function renderCarousel(id: AnimeCarouselId) {
    switch (id) {
      case 'continueWatching':
        if (!viewer?.connected || watchingItems.length === 0) return null;
        return (
          <AnimeMediaRail
            key={id}
            title="Continue Watching"
            items={watchingItems}
            viewAllHref="/anime/library?status=CURRENT"
            size="large"
          />
        );
      case 'planToWatch':
        if (!viewer?.connected || planningItems.length === 0) return null;
        return (
          <AnimeMediaRail
            key={id}
            title="Plan to Watch"
            items={planningItems}
            viewAllHref="/anime/library?status=PLANNING"
          />
        );
      case 'trending':
        return (
          <AnimeMediaRail
            key={id}
            title="Trending Now"
            items={trendingItems}
            viewAllHref="/anime/explore?sort=trending"
            size="large"
          />
        );
      case 'popularThisSeason':
        return (
          <AnimeMediaRail
            key={id}
            title="Popular This Season"
            items={data?.season ?? []}
            viewAllHref={
              currentSeason
                ? `/anime/explore?sort=seasonal&season=${currentSeason.season}&year=${currentSeason.year}`
                : '/anime/explore?sort=seasonal'
            }
            size="large"
          />
        );
      case 'upcomingNextSeason':
        return (
          <AnimeMediaRail
            key={id}
            title="Upcoming Next Season"
            items={data?.nextSeason ?? []}
            viewAllHref={
              nextSeasonInfo
                ? `/anime/explore?sort=seasonal&season=${nextSeasonInfo.season}&year=${nextSeasonInfo.year}`
                : '/anime/explore?sort=seasonal'
            }
          />
        );
      case 'allTimePopular':
        return (
          <AnimeMediaRail
            key={id}
            title="All Time Popular"
            items={data?.popular ?? []}
            viewAllHref="/anime/explore?sort=popularity"
          />
        );
      case 'top100':
        return (
          <AnimeMediaRail
            key={id}
            title="Top 100"
            items={data?.top ?? []}
            viewAllHref="/anime/explore?sort=score"
          />
        );
      default:
        return null;
    }
  }

  return (
    <div className="flex flex-col animate-content-in">
      {/* Search Link — always visible */}
      <div className="flex items-center justify-between gap-2 mb-5">
        <Link
          href="/anime/explore"
          className="flex-1 flex items-center gap-2 bg-muted/50 border border-border/50 text-muted-foreground rounded-full px-4 py-2 text-sm hover:bg-muted transition-colors"
        >
          <Search className="h-4 w-4" />
          <span>Search or browse anime...</span>
        </Link>
        <Link
          href="/anime/schedule"
          className="shrink-0 flex items-center gap-1.5 bg-amber-500/15 border border-amber-500/30 text-amber-300 rounded-full px-3 sm:px-4 py-2 text-sm hover:bg-amber-500/25 transition-colors"
          aria-label="Anime weekly schedule"
        >
          <CalendarClock className="h-4 w-4" />
          <span className="hidden sm:inline">Schedule</span>
        </Link>
        {viewer?.connected && (
          <Link
            href="/anime/library"
            className="shrink-0 flex items-center gap-1.5 bg-pink-500/15 border border-pink-500/30 text-pink-300 rounded-full px-3 sm:px-4 py-2 text-sm hover:bg-pink-500/25 transition-colors"
            aria-label="My AniList library"
          >
            <Sparkles className="h-4 w-4" />
            <span className="hidden sm:inline">My Library</span>
          </Link>
        )}
      </div>

      {loading ? (
        <PageSpinner />
      ) : error ? (
        <div className="py-12 text-center text-muted-foreground">
          {error}
        </div>
      ) : data ? (
        <div className="-mx-2 md:-mx-6">
          {/* Hero Banner */}
          {heroAnime && <HeroBanner anime={heroAnime} />}
          <div className="space-y-5 px-2 md:p-6 md:px-8">
            {orderedCarouselIds
              .filter((id) => !disabledSet.has(id))
              .map((id) => renderCarousel(id))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
