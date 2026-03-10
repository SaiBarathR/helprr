'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Search, Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListMediaSeason, AniListListItem } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

type AnimeItemWithLibrary = AniListListItem & { library?: DiscoverLibraryStatus };

interface HomeData {
  trending: AnimeItemWithLibrary[];
  season: AnimeItemWithLibrary[];
  nextSeason: AnimeItemWithLibrary[];
  popular: AnimeItemWithLibrary[];
  top: AnimeItemWithLibrary[];
}

function getCurrentSeasonClient(): { season: AniListMediaSeason; year: number } {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  if (month >= 4 && month <= 6) return { season: 'SPRING', year };
  if (month >= 7 && month <= 9) return { season: 'SUMMER', year };
  if (month >= 10 && month <= 12) return { season: 'FALL', year };
  return { season: 'WINTER', year };
}

function getNextSeasonClient(currentSeason: AniListMediaSeason, currentYear: number): { season: AniListMediaSeason; year: number } {
  if (currentSeason === 'WINTER') return { season: 'SPRING', year: currentYear };
  if (currentSeason === 'SPRING') return { season: 'SUMMER', year: currentYear };
  if (currentSeason === 'SUMMER') return { season: 'FALL', year: currentYear };
  return { season: 'WINTER', year: currentYear + 1 };
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
    <Link href={`/anime/${anime.id}`} className="block -mx-4 -mt-3">
      <div className="relative h-[280px] overflow-hidden">
        {bannerSrc ? (
          <Image
            src={bannerSrc}
            alt={anime.title}
            fill
            className="object-cover"
            priority
            unoptimized={isProtectedApiImageSrc(bannerSrc)}
          />
        ) : coverSrc ? (
          <Image
            src={coverSrc}
            alt={anime.title}
            fill
            className="object-cover blur-2xl scale-125"
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

export default function AnimeHomePage() {
  const [data, setData] = useState<HomeData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const current = getCurrentSeasonClient();
  const next = getNextSeasonClient(current.season, current.year);

  useEffect(() => {
    async function fetchHome() {
      try {
        const res = await fetch('/api/anime/home');
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

  const heroAnime = data?.trending?.[0] ?? null;
  const trendingItems = data?.trending?.slice(1) ?? [];

  return (
    <div className="flex flex-col pb-20">
      {loading ? (
        <div className="space-y-6">
          {/* Hero skeleton */}
          <Skeleton className="h-[280px] -mx-4 -mt-3 rounded-none" />
          {/* Search bar skeleton */}
          <Skeleton className="h-10 w-full rounded-full" />
          {/* Carousel skeletons */}
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="h-5 w-32 mb-3" />
              <div className="flex gap-3 overflow-hidden -mx-4 px-4">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className={`${i < 2 ? 'h-[210px] w-[140px]' : 'h-[165px] w-[110px]'} rounded-lg flex-shrink-0`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : error ? (
        <div className="px-4 py-12 text-center text-muted-foreground">
          {error}
        </div>
      ) : data ? (
        <div className="space-y-5">
          {/* Hero Banner */}
          {heroAnime && <HeroBanner anime={heroAnime} />}

          {/* Search Link */}
          <div className="flex items-center justify-between">
            <Link
              href="/anime/explore"
              className="flex-1 flex items-center gap-2 bg-muted/50 border border-border/50 text-muted-foreground rounded-full px-4 py-2 text-sm hover:bg-muted transition-colors"
            >
              <Search className="h-4 w-4" />
              <span>Search or browse anime...</span>
            </Link>
          </div>

          {/* Carousels */}
          <AnimeMediaRail
            title="Trending Now"
            items={trendingItems}
            viewAllHref="/anime/explore?sort=trending"
            size="large"
          />
          <AnimeMediaRail
            title="Popular This Season"
            items={data.season}
            viewAllHref={`/anime/explore?sort=popularity&season=${current.season}&year=${current.year}`}
            size="large"
          />
          <AnimeMediaRail
            title="Upcoming Next Season"
            items={data.nextSeason}
            viewAllHref={`/anime/explore?sort=popularity&season=${next.season}&year=${next.year}`}
          />
          <AnimeMediaRail
            title="All Time Popular"
            items={data.popular}
            viewAllHref="/anime/explore?sort=popularity"
          />
          <AnimeMediaRail
            title="Top 100"
            items={data.top}
            viewAllHref="/anime/explore?sort=score"
          />
        </div>
      ) : null}
    </div>
  );
}
