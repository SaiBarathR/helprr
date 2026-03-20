'use client';

import Image from 'next/image';
import { Badge } from '@/components/ui/badge';
import { Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';

interface DiscoverHeroProps {
  title: string;
  backdropPath: string | null;
  posterPath: string | null;
  year: number | null;
  rating: number;
  runtime: number | null;
  certification: string | null;
  tagline: string | null;
  mediaType: 'movie' | 'tv';
}

export function DiscoverHero({
  title,
  backdropPath,
  posterPath,
  year,
  rating,
  runtime,
  certification,
  tagline,
  mediaType,
}: DiscoverHeroProps) {
  const backdropSrc = backdropPath
    ? toCachedImageSrc(backdropPath, 'tmdb') || backdropPath
    : null;
  const posterSrc = posterPath
    ? toCachedImageSrc(posterPath, 'tmdb') || posterPath
    : null;

  return (
    <div className="relative -mx-2 md:-mx-6">
      {/* Backdrop */}
      <div className="relative h-[220px] w-full bg-muted/40">
        {backdropSrc && (
          <Image
            src={backdropSrc}
            alt={title}
            fill
            sizes="100vw"
            className="object-cover animate-hero-zoom"
            priority
            unoptimized={isProtectedApiImageSrc(backdropSrc)}
          />
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-background via-background/50 to-transparent" />
      </div>

      {/* Poster + Info overlay */}
      <div className="relative -mt-[90px] px-2 md:px-6 flex gap-3.5">
        {/* Poster */}
        <div className="relative w-[100px] h-[150px] rounded-lg overflow-hidden bg-muted border border-border/40 shadow-lg shrink-0">
          {posterSrc ? (
            <Image
              src={posterSrc}
              alt={title}
              fill
              sizes="100px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(posterSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs">
              No Poster
            </div>
          )}
        </div>

        {/* Title + meta */}
        <div className="flex-1 min-w-0 pt-[60px]">
          <div className="flex items-center gap-1.5 flex-wrap">
            <Badge className={`text-[10px] text-white ${mediaType === 'movie' ? 'bg-blue-600/80' : 'bg-violet-600/80'}`}>
              {mediaType === 'movie' ? 'MOVIE' : 'SERIES'}
            </Badge>
            {certification && (
              <Badge variant="outline" className="text-[10px]">{certification}</Badge>
            )}
          </div>
          <h1 className="text-lg font-bold leading-tight mt-1 line-clamp-2">{title}</h1>
          <div className="flex items-center gap-1.5 mt-1 text-sm text-muted-foreground flex-wrap">
            {year && <span>{year}</span>}
            {runtime != null && runtime > 0 && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span>{runtime} min</span>
              </>
            )}
            {rating > 0 && (
              <>
                <span className="text-muted-foreground/50">·</span>
                <span className="inline-flex items-center gap-0.5">
                  <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                  {rating.toFixed(1)}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Tagline */}
      {tagline && (
        <p className="px-2 md:px-6 mt-2 text-sm italic text-muted-foreground">{tagline}</p>
      )}
    </div>
  );
}
