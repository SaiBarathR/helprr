'use client';

import Image from 'next/image';
import type { ReactNode } from 'react';
import { Star, Check, Clock } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListMediaFormat, AniListMediaStatus, AniListMediaSeason, AniListNextAiringEpisode } from '@/types/anilist';

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
  inLibrary?: boolean;
  bannerAction?: ReactNode;
  nextAiringSeconds?: string
  nextAiringEpisode?: AniListNextAiringEpisode | null
}

function formatStatus(status: AniListMediaStatus | null): string {
  if (!status) return '';
  return status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ');
}

function formatSeason(season: AniListMediaSeason | null): string {
  if (!season) return '';
  return season.charAt(0) + season.slice(1).toLowerCase();
}

const FORMAT_LABELS: Record<string, string> = {
  TV: 'Television',
  TV_SHORT: 'TV Short',
  MOVIE: 'Anime Film',
  OVA: 'Original Video',
  ONA: 'Original Net',
  SPECIAL: 'Special',
  MUSIC: 'Music',
};

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
  inLibrary,
  bannerAction,
  nextAiringSeconds,
  nextAiringEpisode
}: AnimeHeroProps) {
  const bannerSrc = bannerImage
    ? toCachedImageSrc(bannerImage, 'anilist', { width: 1280 }) || bannerImage
    : null;
  const coverSrc = coverImage
    ? toCachedImageSrc(coverImage, 'anilist') || coverImage
    : null;

  const mainStudios = studios.filter((s) => s.isMain).map((s) => s.name);
  const formatLabel = format ? FORMAT_LABELS[format] || format.replace('_', ' ') : 'Animation';
  const seasonLine = season && seasonYear
    ? `${formatSeason(season)} ${seasonYear}`
    : seasonYear
      ? String(seasonYear)
      : null;

  return (
    <section className="relative -mx-2 md:-mx-6">
      {/* ── Cinematic banner ───────────────────────────────────────── */}
      <div className="relative h-[260px] sm:h-[340px] md:h-[420px] lg:h-[480px] w-full overflow-hidden bg-background">
        {bannerSrc ? (
          <>
            <Image
              src={bannerSrc}
              alt=""
              fill
              sizes="100vw"
              className="object-cover scale-[1.03] animate-hero-zoom"
              priority
              unoptimized={isProtectedApiImageSrc(bannerSrc)}
            />
            <div className="cinema-gradient" aria-hidden />
            <div className="cinema-grain" aria-hidden />
            <div
              aria-hidden
              className="absolute inset-y-0 left-0 w-1/4 bg-gradient-to-r from-background/40 to-transparent light:from-background/25 pointer-events-none"
            />
            <div
              aria-hidden
              className="absolute inset-y-0 right-0 w-1/4 bg-gradient-to-l from-background/40 to-transparent light:from-background/25 pointer-events-none"
            />
          </>
        ) : coverSrc ? (
          <>
            <Image
              src={coverSrc}
              alt=""
              fill
              sizes="100vw"
              className="object-cover scale-110 blur-3xl opacity-60"
              priority
              unoptimized={isProtectedApiImageSrc(coverSrc)}
            />
            <div className="cinema-gradient" aria-hidden />
            <div className="cinema-grain" aria-hidden />
          </>
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-card via-background to-card" />
        )}

        {(inLibrary || bannerAction) && (
          <div className="absolute top-1.5 right-1.5 md:top-5 md:right-6 hero-meta-fade flex flex-col items-end gap-2">
            {bannerAction}
            {inLibrary && (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/70 backdrop-blur-md text-emerald-300 px-3 py-1.5 text-[11px] font-medium status-pill-glow">
                <Check className="h-3 w-3" strokeWidth={2.5} />
                <span className="tracked-caps">In Library</span>
              </span>
            )}
          </div>
        )}

        <div className="absolute top-3 left-3 md:top-5 md:left-6 hero-meta-fade">
          <div className="flex items-center gap-2 text-foreground/65">
            <span className="block w-6 h-px bg-foreground/40 hairline-grow" />
            <span className="tracked-caps">{formatLabel}</span>
          </div>
        </div>
      </div>

      {/* ── Spec strip ─────────────────────────────────────────────── */}
      <div className="relative px-4 md:px-8 lg:px-10 -mt-12 md:-mt-16 flex gap-4 md:gap-6">
        <div className="relative w-[110px] h-[165px] md:w-[140px] md:h-[210px] shrink-0">
          <div className="absolute inset-0 rounded-md overflow-hidden bg-card ring-1 ring-border shadow-[0_20px_50px_-15px_rgba(0,0,0,0.7)]">
            {coverSrc ? (
              <Image
                src={coverSrc}
                alt={title}
                fill
                sizes="(min-width: 768px) 140px, 110px"
                className="object-cover"
                unoptimized={isProtectedApiImageSrc(coverSrc)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[11px] tracked-caps">
                No Art
              </div>
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 pt-12 md:pt-20 space-y-3 md:space-y-4">
          {/* Editorial spec row */}
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1.5">
            {seasonLine && (
              <span className="font-display font-medium text-foreground text-base md:text-lg leading-none">
                {seasonLine}
              </span>
            )}
            {episodes != null && (
              <>
                <span className="block w-px h-3 bg-border self-center" aria-hidden />
                <span className="tracked-caps text-muted-foreground">
                  {episodes} Ep{episodes === 1 ? '' : 's'}
                </span>
              </>
            )}
            {status && (
              <>
                <span className="block w-px h-3 bg-border self-center" aria-hidden />
                <span className="tracked-caps text-muted-foreground">{formatStatus(status)}</span>
              </>
            )}
            {averageScore != null && averageScore > 0 && (
              <>
                <span className="block w-px h-3 bg-border self-center" aria-hidden />
                <span className="inline-flex items-baseline gap-1">
                  <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400 self-center" />
                  <span className="font-display font-medium text-foreground text-base md:text-lg leading-none">
                    {averageScore}
                  </span>
                  <span className="text-[10px] text-muted-foreground">%</span>
                </span>
              </>
            )}
          </div>

          {/* Studio attribution */}
          {mainStudios.length > 0 && (
            <div className="space-y-1 pl-4 md:pl-5 border-l border-border/60">
              <div className="tracked-caps text-muted-foreground">Studio</div>
              <p className="font-display text-foreground/90 leading-snug text-sm md:text-base lg:text-lg">
                {mainStudios.join(' · ')}
              </p>
            </div>
          )}
          {/* Airing Countdown */}
          {nextAiringEpisode && (
            <div className="flex items-center gap-2 py-1">
              <Clock className="h-4 w-4 text-blue-400 shrink-0" />
              <div className="text-sm">
                <span className="font-medium">Ep {nextAiringEpisode.episode}</span>
                <span className="text-muted-foreground"> airing in </span>
                <span className="font-medium text-blue-400">{nextAiringSeconds}</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
