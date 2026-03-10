'use client';

import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListMediaFormat, AniListMediaStatus, AniListMediaSeason } from '@/types/anilist';

interface AnimeHeroProps {
  title: string;
  bannerImage: string | null;
  coverImage: string | null;
  format: AniListMediaFormat | null;
  averageScore: number | null;
  episodes: number | null;
  status: AniListMediaStatus | null;
  season: AniListMediaSeason | null;
  seasonYear: number | null;
  studios: Array<{ name: string; isMain: boolean }>;
}

function formatStatus(status: AniListMediaStatus | null): string {
  if (!status) return '';
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

export function AnimeHero({
  title,
  bannerImage,
  coverImage,
  format,
  averageScore,
  episodes,
  status,
  season,
  seasonYear,
  studios,
}: AnimeHeroProps) {
  const bannerSrc = bannerImage
    ? toCachedImageSrc(bannerImage, 'anilist') || bannerImage
    : null;
  const coverSrc = coverImage
    ? toCachedImageSrc(coverImage, 'anilist') || coverImage
    : null;

  const mainStudios = studios.filter((s) => s.isMain).map((s) => s.name);

  const formatColors: Record<string, string> = {
    TV: 'bg-blue-600/80',
    MOVIE: 'bg-violet-600/80',
    OVA: 'bg-amber-600/80',
    ONA: 'bg-teal-600/80',
    SPECIAL: 'bg-pink-600/80',
    TV_SHORT: 'bg-cyan-600/80',
    MUSIC: 'bg-rose-600/80',
  };

  return (
    <div className="relative">
      {/* Banner */}
      <div className="relative h-[220px] w-full bg-muted/40">
        {bannerSrc ? (
          <Image
            src={bannerSrc}
            alt={title}
            fill
            sizes="100vw"
            className="object-cover"
            priority
            unoptimized={isProtectedApiImageSrc(bannerSrc)}
          />
        ) : coverSrc ? (
          <Image
            src={coverSrc}
            alt={title}
            fill
            sizes="100vw"
            className="object-cover blur-2xl opacity-50"
            priority
            unoptimized={isProtectedApiImageSrc(coverSrc)}
          />
        ) : null}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      </div>

      {/* Poster + Info overlay */}
      <div className="relative -mt-[90px] flex gap-3.5">
        <div className="relative w-[100px] h-[150px] rounded-lg overflow-hidden bg-muted border border-border/40 shadow-lg shrink-0">
          {coverSrc ? (
            <Image
              src={coverSrc}
              alt={title}
              fill
              sizes="100px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(coverSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
              No Image
            </div>
          )}
        </div>

        <div className="flex-1 min-w-0 pt-[60px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            {format && (
              <Badge className={`text-[10px] text-white ${formatColors[format] || 'bg-gray-600/80'}`}>
                {format.replace('_', ' ')}
              </Badge>
            )}
            {averageScore != null && averageScore > 0 && (
              <Badge className="bg-yellow-600/80 text-[10px] text-white gap-0.5">
                <Star className="h-2.5 w-2.5 fill-current" />
                {averageScore}%
              </Badge>
            )}
            {status && (
              <Badge variant="outline" className="text-[10px]">
                {formatStatus(status)}
              </Badge>
            )}
          </div>
          <h1 className="text-lg font-bold leading-tight mt-1 line-clamp-2">{title}</h1>
          <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground flex-wrap">
            {season && seasonYear && (
              <span>{season.charAt(0) + season.slice(1).toLowerCase()} {seasonYear}</span>
            )}
            {!season && seasonYear && <span>{seasonYear}</span>}
            {episodes != null && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span>{episodes} ep{episodes !== 1 ? 's' : ''}</span>
              </>
            )}
          </div>
          {mainStudios.length > 0 && (
            <p className="text-xs text-muted-foreground mt-0.5 truncate">
              {mainStudios.join(', ')}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
