'use client';

import { HeroImage } from '@/components/media/hero-image';
import { FadeInImage } from '@/components/media/fade-in-image';
import Link from '@/components/ui/app-link';
import { AnimeHero } from '@/components/anime/anime-hero';
import { Skeleton } from '@/components/ui/skeleton';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { Bookmark, Bell, Tv, Heart, ChevronRight, ChevronLeft, Loader2, Sparkles } from 'lucide-react';
import type { DiscoverTvFullDetail, SonarrSeries } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { seasonTabLabel } from '@/lib/anilist-title-match';
import { formatCountdown } from './format';
import type { SeriesAnime } from './use-series-anime';
import type { SeriesDialog } from './types';

/**
 * The top of the page: an anime's season tabs and AniList hero, else the TMDB
 * backdrop with the poster, else the poster alone, each with the status badge
 * and title.
 */
export function SeriesHero({
  series,
  isAnimeSeries,
  anime,
  tmdbData,
  poster,
  statusLabel,
  statusColor,
  canScheduleAlert,
  contextGroups,
  open,
}: {
  series: SonarrSeries;
  isAnimeSeries: boolean;
  anime: SeriesAnime;
  tmdbData: DiscoverTvFullDetail | null;
  poster: string | null | undefined;
  statusLabel: string;
  statusColor: string;
  canScheduleAlert: boolean;
  contextGroups: ContextActionGroup[];
  open: (dialog: SeriesDialog) => void;
}) {
  const {
    animeEntries, animeDetailsById, animePrimaryTitle, expandedAnimeTabId, setExpandedAnimeTabId,
    activeAnimeIdx, selectAnimeTab, animeDetail, nextAiringSeconds, activeDetailLoading, animeLoading,
  } = anime;
  return (
    <>
      {isAnimeSeries && animeEntries.length > 1 && (
        <div data-scroll-restoration-key="series-anime-tabs" className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-3 -mx-2 px-2 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {animeEntries.map((entry, index) => {
            const detail = animeDetailsById.get(entry.anilistMediaId);
            const fullTitle = detail?.title ?? entry.titleSnapshot ?? `AniList #${entry.anilistMediaId}`;
            const shortLabel = seasonTabLabel(fullTitle, animePrimaryTitle) ?? fullTitle;
            const expanded = expandedAnimeTabId === entry.anilistMediaId;
            const label = expanded
              ? detail?.seasonYear
                ? `${fullTitle} · ${detail.seasonYear}`
                : fullTitle
              : shortLabel;
            const active = index === activeAnimeIdx;
            return (
              <div
                key={entry.anilistMediaId}
                className={`flex shrink-0 items-center rounded-full text-xs font-medium transition-colors ${
                  active
                    ? 'bg-[var(--hpr-amber)]/20 text-[var(--hpr-amber)]'
                    : 'bg-muted/30 text-muted-foreground'
                }`}
              >
                <button
                  onClick={() => selectAnimeTab(index)}
                  title={detail?.seasonYear ? `${fullTitle} · ${detail.seasonYear}` : fullTitle}
                  className={`truncate py-1.5 pl-3 ${expanded ? '' : 'max-w-[150px]'}`}
                >
                  {label}
                </button>
                {/* Mobile has no hover — the chevron expands the chip to the full name. */}
                <button
                  onClick={() => setExpandedAnimeTabId(expanded ? null : entry.anilistMediaId)}
                  aria-label={expanded ? 'Shrink season name' : 'Show full season name'}
                  className="py-1.5 pl-1 pr-2.5"
                >
                  {expanded ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                </button>
              </div>
            );
          })}
        </div>
      )}
      {isAnimeSeries && animeDetail ? (
        <AnimeHero
          title={animeDetail.title}
          bannerImage={animeDetail.bannerImage}
          coverImage={animeDetail.coverImage}
          format={animeDetail.format}
          averageScore={animeDetail.averageScore}
          episodes={animeDetail.episodes}
          status={animeDetail.status}
          season={animeDetail.season}
          seasonYear={animeDetail.seasonYear}
          studios={animeDetail.studios}
          bannerAction={(
            <Link
              href={`/anime/${animeDetail.id}`}
              className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5" />
              <span className="tracking-widest uppercase">Open in Anime</span>
            </Link>
          )}
          nextAiringSeconds={formatCountdown(nextAiringSeconds ?? 0)}
          nextAiringEpisode={animeDetail.nextAiringEpisode}
        />
      ) : isAnimeSeries && animeEntries.length > 0 ? (
        // Active tab's detail is loading (lazy per-tab fetch) — hero-height placeholder.
        <div className="-mx-2 md:-mx-6">
          <div className="relative flex h-[220px] w-full items-center justify-center bg-muted/20">
            {activeDetailLoading || animeLoading ? (
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            ) : (
              <button
                onClick={() => selectAnimeTab(activeAnimeIdx)}
                className="rounded-full bg-background/55 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md hover:bg-background/70"
              >
                Couldn&apos;t load this season — tap to retry
              </button>
            )}
          </div>
          <div className="mt-4 space-y-2 px-2 md:px-6">
            <Skeleton className="h-5 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-1/3" />
          </div>
        </div>
      ) : tmdbData?.backdropPath ? (
        <div className='-mx-2 md:-mx-6'>
          <div className="relative w-full h-[220px] overflow-hidden bg-muted/40 ">
            <HeroImage
              src={toCachedImageSrc(tmdbData.backdropPath, 'tmdb', { width: 1280 }) || tmdbData.backdropPath}
              alt=""
              fill
              sizes="100vw"
              className="object-cover"
              priority
              unoptimized
            />
            <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent light:via-background/25" />
            {/* Watchlist + schedule alert icons — top right, mirrors discover hero */}
            <div className="absolute top-2 right-2 flex items-center gap-1.5">
              <button
                type="button"
                aria-label="Add to watchlist"
                onClick={() => open('watchlist')}
                className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
              {canScheduleAlert && (
                <button
                  type="button"
                  aria-label="Schedule alert"
                  onClick={() => open('scheduleAlert')}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
                >
                  <Bell className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
          </div>
          <div className="relative -mt-[90px] px-2 md:px-6 flex gap-3.5">
            <div className="w-[100px] shrink-0">
              <QuickContextMenu label={`${series.title} actions`} groups={contextGroups}>
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-lg ring-1 ring-border/20">
                {poster ? (
                  <FadeInImage
                    src={poster}
                    alt={series.title}
                    fill
                    sizes="100px"
                    className="object-cover"
                    unoptimized={isProtectedApiImageSrc(poster)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Tv className="h-8 w-8" />
                  </div>
                )}
              </div>
              </QuickContextMenu>
            </div>
            <div className="flex-1 min-w-0 pt-[60px]">
              <span className={`inline-block text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusColor} mb-1.5`}>
                {statusLabel}
              </span>
              <h1 className="text-lg font-bold leading-tight">{series.title}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {series.year}
                {series.runtime > 0 && <> &middot; {series.runtime}m</>}
                {series.certification && <> &middot; {series.certification}</>}
              </p>
              {series.ratings && series.ratings.value > 0 && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                  <span className="text-sm font-medium">{Math.round(series.ratings.value * 10)}%</span>
                </div>
              )}
            </div>
          </div>
          {tmdbData.tagline && (
            <p className="px-2 md:px-6 mt-3 text-sm italic text-muted-foreground">&ldquo;{tmdbData.tagline}&rdquo;</p>
          )}
        </div>
      ) : (
        <div className="flex gap-4 pt-3 pb-4">
          <div className="w-28 shrink-0">
            <QuickContextMenu label={`${series.title} actions`} groups={contextGroups}>
            <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
              {poster ? (
                <FadeInImage
                  src={poster}
                  alt={series.title}
                  width={112}
                  height={168}
                  className="w-full h-full object-cover"
                  unoptimized={isProtectedApiImageSrc(poster)}
                />
              ) : (
                <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                  <Tv className="h-10 w-10" />
                </div>
              )}
              <button
                type="button"
                aria-label="Add to watchlist"
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  open('watchlist');
                }}
                className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
              >
                <Bookmark className="h-3.5 w-3.5" />
              </button>
            </div>
            </QuickContextMenu>
          </div>
          <div className="flex-1 min-w-0 pt-1">
            <span className={`inline-block text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusColor} mb-1.5`}>
              {statusLabel}
            </span>
            <h1 className="text-lg font-bold leading-tight">{series.title}</h1>
            <p className="text-sm text-muted-foreground mt-0.5">
              {series.year}
              {series.runtime > 0 && <> &middot; {series.runtime}m</>}
              {series.certification && <> &middot; {series.certification}</>}
            </p>
            {series.ratings && series.ratings.value > 0 && (
              <div className="flex items-center gap-1 mt-1.5">
                <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                <span className="text-sm font-medium">{Math.round(series.ratings.value * 10)}%</span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
