'use client';

import { FadeInImage } from '@/components/media/fade-in-image';
import Link from '@/components/ui/app-link';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { Bookmark, Search, ChevronDown, ChevronUp, ChevronRight, Star, Check } from 'lucide-react';
import type { DiscoverTvFullDetail, SonarrEpisode, SonarrSeries } from '@/types';
import type { EpisodeWatchStatus } from '@/types/watch-status';
import { toCachedImageSrc } from '@/lib/image';
import { ExpandedSeasonEpisodes } from './expanded-season-episodes';

/**
 * The Seasons list, newest first: each season's file count, watched count and
 * TMDB rating, its monitored toggle, and (for a non-anime series) its TMDB
 * episodes on expand.
 */
export function SeriesSeasons({
  series,
  routeId,
  instance,
  episodes,
  episodesError,
  episodesFetching,
  onRetryEpisodes,
  tmdbData,
  expandedSeasons,
  onToggleExpand,
  watchedBySeason,
  episodeWatch,
  canEditMonitoring,
  canManageActivity,
  onToggleSeasonMonitor,
  onInteractiveSearch,
}: {
  series: SonarrSeries;
  routeId: string;
  instance: string | undefined;
  episodes: SonarrEpisode[];
  episodesError: boolean;
  episodesFetching: boolean;
  onRetryEpisodes: () => void;
  tmdbData: DiscoverTvFullDetail | null;
  expandedSeasons: Set<number>;
  onToggleExpand: (seasonNumber: number) => void;
  watchedBySeason: Record<number, number>;
  episodeWatch: Record<string, EpisodeWatchStatus>;
  canEditMonitoring: boolean;
  canManageActivity: boolean;
  onToggleSeasonMonitor: (seasonNumber: number, monitored: boolean) => void;
  onInteractiveSearch: (target: { seasonNumber: number; label: string }) => void;
}) {
  const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => b - a);
  return (
    <div className="mt-4 [grid-area:seasons]">
      <h2 className="text-lg font-bold mb-2">Seasons</h2>
      {/* Episodes failing must not render as a series with no seasons. */}
      {episodesError && episodes.length === 0 && (
        <ErrorState
          compact
          message="Couldn't load episodes for this series."
          onRetry={onRetryEpisodes}
          retrying={episodesFetching}
        />
      )}
      {/* A failed refresh keeps the last loaded episodes; say so rather
          than let them pass for current. */}
      {episodesError && episodes.length > 0 && (
        <div className="mb-2 flex items-center justify-center gap-2 rounded-lg bg-destructive/10 px-3 py-2 text-xs text-red-400 light:text-red-800">
          <span>Couldn&apos;t refresh episodes. Showing the last loaded list.</span>
          <Button
            variant="link"
            size="sm"
            className="h-auto p-0 text-xs text-red-400 light:text-red-800"
            onClick={onRetryEpisodes}
            disabled={episodesFetching}
          >
            Retry
          </Button>
        </div>
      )}
      <div>
        {seasonNumbers.map((sn) => {
          const seasonEps = episodes.filter((e) => e.seasonNumber === sn);
          const fileCount = seasonEps.filter((e) => e.hasFile).length;
          const total = seasonEps.length;
          const seasonData = series.seasons.find((s) => s.seasonNumber === sn);
          const isMonitored = seasonData?.monitored ?? true;
          const isAnime = series.seriesType === 'anime';
          const tmdbSeason = isAnime ? undefined : tmdbData?.seasons?.find((s) => s.seasonNumber === sn);
          const isExpanded = expandedSeasons.has(sn);
          const seasonHref = `/series/${routeId}/season/${sn}${instance ? `?instance=${instance}` : ''}`;
          const seasonActions = [
            { id: 'open', label: 'Open season', href: seasonHref },
            ...(canEditMonitoring ? [{ id: 'monitor', label: isMonitored ? 'Unmonitor season' : 'Monitor season', icon: <Bookmark className="h-4 w-4" />, onSelect: () => { void onToggleSeasonMonitor(sn, !isMonitored); } }] : []),
            ...(canManageActivity ? [{
              id: 'interactive',
              label: 'Interactive search…',
              icon: <Search className="h-4 w-4" />,
              onSelect: () => {
                onInteractiveSearch({
                  seasonNumber: sn,
                  label: sn === 0 ? 'Specials' : `Season ${sn}`,
                });
              },
            }] : []),
            ...(tmdbData && !isAnime ? [{ id: 'expand', label: isExpanded ? 'Collapse episodes' : 'Show episodes', icon: isExpanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />, onSelect: () => onToggleExpand(sn) }] : []),
          ];

          return (
            <div key={sn} className="border-b border-border/50">
              <div className="flex items-center py-3.5 gap-2">
                {/* TMDB season poster */}
                {tmdbSeason?.posterPath && (
                  <div className="relative w-[45px] h-[67px] rounded overflow-hidden shrink-0">
                    <FadeInImage
                      src={toCachedImageSrc(tmdbSeason.posterPath, 'tmdb') || tmdbSeason.posterPath}
                      alt=""
                      fill
                      sizes="45px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                )}
                <QuickContextMenu label={`${sn === 0 ? 'Specials' : `Season ${sn}`} actions`} actions={seasonActions}>
                <Link href={seasonHref} className="flex-1 min-w-0 flex items-center gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{sn === 0 ? 'Specials' : `Season ${sn}`}</span>
                      <span className="text-sm text-muted-foreground">{fileCount}/{total}</span>
                      {(watchedBySeason[sn] ?? 0) > 0 && (
                        <span className="inline-flex items-center gap-0.5 text-xs font-medium text-[var(--hpr-amber)]" title={`${watchedBySeason[sn]} watched`}>
                          <Check className="h-3 w-3" strokeWidth={3} />{watchedBySeason[sn]}
                        </span>
                      )}
                    </div>
                    {tmdbSeason && tmdbSeason.voteAverage > 0 && (
                      <div className="flex items-center gap-1 mt-0.5">
                        <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                        <span className="text-xs text-muted-foreground">{tmdbSeason.voteAverage.toFixed(1)}</span>
                      </div>
                    )}
                    {tmdbSeason?.overview && (
                      <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{tmdbSeason.overview}</p>
                    )}
                  </div>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </Link>
                </QuickContextMenu>
                {/* Expand/collapse for TMDB episodes (not for anime) */}
                {tmdbData && !isAnime && (
                  <button
                    onClick={() => onToggleExpand(sn)}
                    className="min-w-[36px] min-h-[44px] flex items-center justify-center"
                    aria-label={sn === 0 ? 'Specials episodes' : `Season ${sn} episodes`}
                    aria-expanded={isExpanded}
                  >
                    {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                  </button>
                )}
                {/* Monitor toggle — admin-gated */}
                {canEditMonitoring && (
                  <button
                    onClick={() => onToggleSeasonMonitor(sn, !isMonitored)}
                    className="min-w-[36px] min-h-[44px] flex items-center justify-center"
                    aria-label={sn === 0 ? 'Specials monitored' : `Season ${sn} monitored`}
                    aria-pressed={isMonitored}
                  >
                    {isMonitored ? (
                      <Bookmark className="h-5 w-5 fill-current text-foreground" />
                    ) : (
                      <Bookmark className="h-5 w-5 text-muted-foreground" />
                    )}
                  </button>
                )}
              </div>
              {/* Expanded episode cards */}
              {isExpanded && series.tmdbId && (
                <ExpandedSeasonEpisodes
                  tmdbId={series.tmdbId}
                  seasonNumber={sn}
                  seasonEps={seasonEps}
                  seriesRouteId={routeId}
                  instance={instance}
                  episodeWatch={episodeWatch}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
