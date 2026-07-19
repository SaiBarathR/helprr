'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import Image from 'next/image';
import Link from 'next/link';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { AnimeSearchOverlay } from '@/components/anime/anime-search-overlay';
import { HeroCarousel } from '@/components/hero-carousel';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Star, Sparkles, CalendarClock, LayoutGrid } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useUIStore } from '@/lib/store';
import { useMe } from '@/components/permission-provider';
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

// The library list endpoint is cached under ['anilist','library',type,status],
// a key shared with /anime/library. Both must cache the SAME shape (the raw
// { collection } response); each derives its own view. Here we flatten to rail
// entries via `select`; the library page reads `.collection` directly. Returning
// different shapes from the two queryFns corrupts the shared cache.
type LibraryCollectionResponse = { collection: AniListMediaListCollection };
const selectLibraryEntries = (lib: LibraryCollectionResponse): AniListMediaListEntry[] =>
  flattenEntries(lib.collection);

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

function HeroBanner({ anime, priority = false }: { anime: AnimeItemWithLibrary; priority?: boolean }) {
  const bannerSrc = anime.bannerImage
    ? toCachedImageSrc(anime.bannerImage, 'anilist', { width: 1280 }) || anime.bannerImage
    : null;
  const coverSrc = anime.coverImage
    ? toCachedImageSrc(anime.coverImage, 'anilist') || anime.coverImage
    : null;

  const accentColor = anime.coverImageColor || '#6366f1';

  return (
    <Link href={`/anime/${anime.id}`} className="block h-full">
      <div className="relative h-full overflow-hidden">
        {bannerSrc ? (
          <Image
            src={bannerSrc}
            alt={anime.title}
            fill
            className="object-cover animate-hero-zoom"
            priority={priority}
            unoptimized={isProtectedApiImageSrc(bannerSrc)}
          />
        ) : coverSrc ? (
          <Image
            src={coverSrc}
            alt={anime.title}
            fill
            className="object-cover blur-2xl scale-125 animate-hero-zoom"
            priority={priority}
            unoptimized={isProtectedApiImageSrc(coverSrc)}
          />
        ) : (
          <div className="absolute inset-0 bg-muted" />
        )}
        {/* Gradient overlays */}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent light:via-background/25" />
        <div
          className="absolute inset-0 opacity-20"
          style={{ background: `linear-gradient(135deg, ${accentColor}40, transparent 60%)` }}
        />
        {/* Content — extra bottom padding keeps badges clear of the carousel dots */}
        <div className="absolute bottom-0 left-0 right-0 px-4 pt-4 pb-9 flex flex-col gap-1.5">
          {/* Hero shows the featured title; the page-name h1 is sr-only at the root. */}
          <h2 className="text-xl font-bold leading-tight line-clamp-2 drop-shadow-lg">{anime.title}</h2>
          <div className="flex items-center gap-2 flex-wrap">
            {anime.averageScore != null && anime.averageScore > 0 && (
              <Badge className="bg-background/50 text-foreground text-[10px] gap-0.5 backdrop-blur-sm">
                <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                {anime.averageScore}%
              </Badge>
            )}
            {anime.format && (
              <Badge variant="outline" className="text-[10px] border-foreground/30 text-foreground backdrop-blur-sm">
                {anime.format.replace('_', ' ')}
              </Badge>
            )}
            {anime.genres.slice(0, 3).map((genre) => (
              <Badge key={genre} variant="outline" className="text-[10px] border-foreground/30 text-foreground backdrop-blur-sm">
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
  // perPage is fixed at mount (no resize handler, matching prior behavior).
  const [perPage] = useState(() =>
    typeof window !== 'undefined' ? getHomePerPageFromWidth(window.innerWidth) : 10,
  );
  // Hide the right-side action pills while the search field is focused so the
  // bar can use the full row width.
  const [searchExpanded, setSearchExpanded] = useState(false);
  // AniList is a single shared operator account; its list (My Library, Continue
  // Watching, Plan to Watch) is admin-only — members never see it.
  const me = useMe();
  const isAdmin = me?.role === 'admin';

  const homeQuery = useQuery({
    queryKey: ['anime', 'home', perPage],
    queryFn: jsonFetcher<HomeData>(`/api/anime/home?perPage=${perPage}`),
  });
  const data = homeQuery.data ?? null;
  const loading = homeQuery.isLoading;
  const error = homeQuery.isError ? 'Failed to load anime' : null;

  const viewerQuery = useQuery({
    queryKey: ['anilist', 'viewer'],
    queryFn: async ({ signal }): Promise<ViewerSummary> => {
      const res = await fetch('/api/anilist/viewer', { signal });
      if (!res.ok) return { connected: false };
      const json = await res.json();
      return { connected: !!json.connected, user: json.user };
    },
    enabled: isAdmin,
  });
  const viewer: ViewerSummary | null = isAdmin ? (viewerQuery.data ?? null) : { connected: false };

  const libraryEnabled = isAdmin && !!viewer?.connected;
  const watchingQuery = useQuery({
    queryKey: ['anilist', 'library', 'ANIME', 'CURRENT'],
    queryFn: async ({ signal }): Promise<LibraryCollectionResponse> => {
      const res = await fetch('/api/anilist/library?type=ANIME&status=CURRENT', { signal });
      if (!res.ok) throw new ApiError(res.status, 'library CURRENT');
      return (await res.json()) as LibraryCollectionResponse;
    },
    enabled: libraryEnabled,
    select: selectLibraryEntries,
  });
  const planningQuery = useQuery({
    queryKey: ['anilist', 'library', 'ANIME', 'PLANNING'],
    queryFn: async ({ signal }): Promise<LibraryCollectionResponse> => {
      const res = await fetch('/api/anilist/library?type=ANIME&status=PLANNING', { signal });
      if (!res.ok) throw new ApiError(res.status, 'library PLANNING');
      return (await res.json()) as LibraryCollectionResponse;
    },
    enabled: libraryEnabled,
    select: selectLibraryEntries,
  });

  const animeCarouselOrder = useUIStore((s) => s.animeCarouselOrder);
  const disabledAnimeCarousels = useUIStore((s) => s.disabledAnimeCarousels);

  const heroItems = data?.trending?.slice(0, 5) ?? [];
  const trendingItems = data?.trending?.slice(1) ?? [];
  const currentSeason = data?.currentSeason;
  const nextSeasonInfo = data?.nextSeasonInfo;

  const watchingItems = useMemo(() => (watchingQuery.data ?? []).map(entryToRailItem), [watchingQuery.data]);
  const planningItems = useMemo(() => (planningQuery.data ?? []).map(entryToRailItem), [planningQuery.data]);

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
      <h1 className="sr-only">Anime</h1>
      {/* Search bar (in-place live search) + Browse — always visible, pinned on scroll */}
      <div className="page-toolbar page-toolbar-flush pb-2 mb-3 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 flex items-center justify-between gap-2">
        <AnimeSearchOverlay onExpandedChange={setSearchExpanded} />
        {!searchExpanded && (
          <>
            <Link
              href="/anime/explore"
              className="shrink-0 flex items-center gap-1.5 bg-muted/50 border border-border/50 text-muted-foreground rounded-full px-3 sm:px-4 py-2 text-sm hover:bg-muted transition-colors"
              aria-label="Browse anime"
            >
              <LayoutGrid className="h-4 w-4" />
              <span className="hidden sm:inline">Browse</span>
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
          </>
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
          {heroItems.length > 0 && (
            <HeroCarousel
              className="-mx-2 -mt-3 h-[280px]"
              slides={heroItems.map((anime, i) => (
                <HeroBanner key={anime.id} anime={anime} priority={i === 0} />
              ))}
            />
          )}
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
