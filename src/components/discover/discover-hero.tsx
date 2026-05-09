'use client';

import Image from 'next/image';
import { Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { DiscoverDetail } from '@/types';
import { DiscoverAddButton } from './discover-add-button';

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
  inLibrary?: boolean;
  genres?: string[];
  detail: DiscoverDetail
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
  inLibrary,
  genres,
  detail
}: DiscoverHeroProps) {
  const backdropSrc = backdropPath
    ? toCachedImageSrc(backdropPath, 'tmdb') || backdropPath
    : null;
  const posterSrc = posterPath
    ? toCachedImageSrc(posterPath, 'tmdb') || posterPath
    : null;

  const mediaLabel = mediaType === 'movie' ? 'Feature Film' : 'Television Series';

  return (
    <section className="relative -mx-2 md:-mx-6">
      {/* ── Cinematic backdrop ─────────────────────────────────────── */}
      <div className="relative h-[260px] sm:h-[340px] md:h-[420px] lg:h-[480px] w-full overflow-hidden bg-black">
        {backdropSrc ? (
          <>
            <Image
              src={backdropSrc}
              alt=""
              fill
              sizes="100vw"
              className="object-cover scale-[1.03] animate-hero-zoom"
              priority
              unoptimized={isProtectedApiImageSrc(backdropSrc)}
            />
            <div className="cinema-gradient" aria-hidden />
            <div className="cinema-grain" aria-hidden />
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-black/40 to-transparent pointer-events-none"
            />
            <div
              aria-hidden
              className="absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-black/40 to-transparent pointer-events-none"
            />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-zinc-900 via-black to-zinc-950" />
        )}

        {/* Open in / Add to button top right */}
        <DiscoverAddButton detail={detail} />

        {/* Editorial slug — top left */}
        <div className="absolute top-3 left-3 md:top-5 md:left-6 hero-meta-fade">
          <div className="flex items-center gap-2 text-white/65">
            <span className="block w-6 h-px bg-white/40 hairline-grow" />
            <span className="tracked-caps">{mediaLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Spec strip: poster + meta + tagline + genres ───────────── */}
      <div className="relative px-4 md:px-8 lg:px-10 -mt-12 md:-mt-16 flex gap-4 md:gap-6">
        {/* Poster */}
        <div className="relative w-[110px] h-[165px] md:w-[140px] md:h-[210px] shrink-0">
          <div className="absolute inset-0 rounded-md overflow-hidden bg-zinc-900 ring-1 ring-white/10 shadow-[0_20px_50px_-15px_rgba(0,0,0,0.7)]">
            {posterSrc ? (
              <Image
                src={posterSrc}
                alt={title}
                fill
                sizes="(min-width: 768px) 140px, 110px"
                className="object-cover"
                unoptimized={isProtectedApiImageSrc(posterSrc)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[11px] tracked-caps">
                No Art
              </div>
            )}
          </div>
        </div>

        {/* Metadata column */}
        <div className="flex-1 min-w-0 pt-12 md:pt-20 space-y-3 md:space-y-4">
          {/* Editorial spec row */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            {year && (
              <span className="font-display font-medium text-foreground text-base md:text-lg leading-none">
                {year}
              </span>
            )}
            {runtime != null && runtime > 0 && (
              <>
                <span className="block w-px h-3 bg-border self-center" aria-hidden />
                <span className="tracked-caps text-muted-foreground">{runtime} Min</span>
              </>
            )}
            {certification && (
              <>
                <span className="block w-px h-3 bg-border self-center" aria-hidden />
                <span className="rounded-sm border border-border px-1.5 py-px text-[10px] font-semibold tracking-wider text-muted-foreground">
                  {certification}
                </span>
              </>
            )}
            {rating > 0 && (
              <>
                <span className="block w-px h-3 bg-border self-center" aria-hidden />
                <span className="inline-flex items-baseline gap-1">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 self-center" />
                  <span className="font-display font-medium text-foreground text-base md:text-lg leading-none">
                    {rating.toFixed(1)}
                  </span>
                  <span className="text-[10px] text-muted-foreground">/10</span>
                </span>
              </>
            )}
          </div>

          {/* Tagline pull-quote */}
          {tagline && (
            <figure className="relative pl-4 md:pl-5 border-l border-border/60">
              <blockquote className="font-display text-foreground/85 leading-snug text-sm md:text-base lg:text-lg">
                {tagline}
              </blockquote>
            </figure>
          )}

          {/* Genres editorial row */}
          {genres && genres.length > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              {genres.map((genre, i) => (
                <span key={genre} className="flex items-center gap-3">
                  {i > 0 && <span className="block w-1 h-1 rounded-full bg-border" aria-hidden />}
                  <span className="tracked-caps text-muted-foreground">{genre}</span>
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
