'use client';

import { FadeInImage } from '@/components/media/fade-in-image';
import Link from '@/components/ui/app-link';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ChevronRight, Loader2, Star } from 'lucide-react';
import type { SonarrEpisode, DiscoverSeasonDetailResponse } from '@/types';
import { jsonFetcher } from '@/lib/query-fetch';
import { tvSeasonKey } from '@/lib/series-query-cache';
import { toCachedImageSrc } from '@/lib/image';
import { EpisodeWatchIndicator } from '@/components/jellyfin/watch-status-indicator';
import { episodeKey, type EpisodeWatchStatus } from '@/types/watch-status';

// TMDB episode list for an expanded (non-anime) season. Mounted only while the
// season is expanded; its useQuery caches per-(tmdbId, season) so re-expanding —
// or navigating to the season page (which shares tvSeasonKey) — is an instant
// cache hit instead of a refetch.
export function ExpandedSeasonEpisodes({
  tmdbId,
  seasonNumber,
  seasonEps,
  seriesRouteId,
  instance,
  episodeWatch,
}: {
  tmdbId: number;
  seasonNumber: number;
  seasonEps: SonarrEpisode[];
  seriesRouteId: string;
  instance?: string;
  episodeWatch: Record<string, EpisodeWatchStatus>;
}) {
  const { data: epData, isError: epError } = useQuery({
    queryKey: tvSeasonKey(tmdbId, seasonNumber),
    queryFn: jsonFetcher<DiscoverSeasonDetailResponse>(`/api/discover/tv/${tmdbId}/season/${seasonNumber}`),
    staleTime: 30 * 60_000,
  });

  return (
    <div className="pb-3 pl-2">
      {epData ? (
        (epData.episodes ?? []).map((ep) => {
          const sonarrEp = seasonEps.find((e) => e.episodeNumber === ep.episodeNumber);
          const episodeHref = sonarrEp
            ? `/series/${seriesRouteId}/season/${seasonNumber}/episode/${sonarrEp.id}${instance ? `?instance=${instance}` : ''}`
            : null;

          const content = (
            <>
              {ep.stillPath && (
                <div className="relative w-[90px] h-[50px] rounded overflow-hidden shrink-0 bg-muted">
                  <FadeInImage
                    src={toCachedImageSrc(ep.stillPath, 'tmdb') || ep.stillPath}
                    alt=""
                    fill
                    sizes="90px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium line-clamp-1">E{ep.episodeNumber} &middot; {ep.name}</p>
                  {sonarrEp?.hasFile && (
                    <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" title="Downloaded" />
                  )}
                  <span className="ml-auto shrink-0 pl-2">
                    <EpisodeWatchIndicator status={episodeWatch[episodeKey(seasonNumber, ep.episodeNumber)]} />
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  {ep.airDate && <span>{format(new Date(ep.airDate), 'MMM d, yyyy')}</span>}
                  {ep.runtime && <span>{ep.runtime}m</span>}
                  {ep.voteAverage > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                      {ep.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
                {ep.overview && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{ep.overview}</p>}
              </div>
              {episodeHref && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />}
            </>
          );

          return episodeHref ? (
            <Link
              key={ep.id}
              href={episodeHref}
              className="flex gap-3 py-2 border-t border-border/20 active:bg-muted/50 transition-colors"
            >
              {content}
            </Link>
          ) : (
            <div
              key={ep.id}
              className="flex gap-3 py-2 border-t border-border/20"
            >
              {content}
            </div>
          );
        })
      ) : epError ? (
        <div className="py-4 text-sm text-muted-foreground">Failed to load episodes.</div>
      ) : (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading episodes...
        </div>
      )}
    </div>
  );
}
