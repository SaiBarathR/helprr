'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import { Search, Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListMediaSeason, AniListListItem } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

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
  const currentSeason = data?.currentSeason;
  const nextSeasonInfo = data?.nextSeasonInfo;

  return (
    <div className="flex flex-col">
      {/* Search Link — always visible */}
      <div className="flex items-center justify-between mb-5">
        <Link
          href="/anime/explore"
          className="flex-1 flex items-center gap-2 bg-muted/50 border border-border/50 text-muted-foreground rounded-full px-4 py-2 text-sm hover:bg-muted transition-colors"
        >
          <Search className="h-4 w-4" />
          <span>Search or browse anime...</span>
        </Link>
      </div>

      {loading ? (
        <PageSpinner />
      ) : error ? (
        <div className="py-12 text-center text-muted-foreground">
          {error}
        </div>
      ) : data ? (
        <div className="space-y-5">
          {/* Hero Banner */}
          {heroAnime && <HeroBanner anime={heroAnime} />}

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
            viewAllHref={
              currentSeason
                ? `/anime/explore?sort=seasonal&season=${currentSeason.season}&year=${currentSeason.year}`
                : '/anime/explore?sort=seasonal'
            }
            size="large"
          />
          <AnimeMediaRail
            title="Upcoming Next Season"
            items={data.nextSeason}
            viewAllHref={
              nextSeasonInfo
                ? `/anime/explore?sort=seasonal&season=${nextSeasonInfo.season}&year=${nextSeasonInfo.year}`
                : '/anime/explore?sort=seasonal'
            }
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
