'use client';

import { useQuery } from '@tanstack/react-query';
import { Star } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useCan } from '@/components/permission-provider';
import { formatRatingVotes, movieRatingItems, seriesRatingItems, type RatingItem } from '@/lib/arr-ratings';
import type { DiscoverMovieFullDetail, DiscoverTvFullDetail, RadarrMovie, SonarrSeries } from '@/types';

/**
 * The multi-provider rating strip, sourced from Radarr.
 *
 * TMDB alone only publishes its own score. The IMDb / Rotten Tomatoes /
 * Metacritic / Trakt spread lives on the arr record, so this resolves the
 * Jellyfin item to its arr id through `/api/discover`'s `addTarget` — which
 * already reports whether the title exists in Radarr or Sonarr and where —
 * then reads that record's ratings.
 *
 * Sonarr publishes one aggregate rather than a spread, so a series shows a
 * single honest entry instead of a faked row.
 */
export function CatalogRatingsStrip({
  tmdbId,
  mediaType,
}: {
  tmdbId?: number;
  mediaType: 'movie' | 'tv';
}) {
  const canDiscover = useCan('discover.view');
  const canSeeMovies = useCan('movies.view');
  const canSeeSeries = useCan('series.view');

  const discover = useQuery({
    queryKey: queryKeys.discoverDetail(mediaType, tmdbId),
    queryFn: jsonFetcher<DiscoverMovieFullDetail | DiscoverTvFullDetail>(`/api/discover/${mediaType}/${tmdbId}`),
    enabled: canDiscover && Boolean(tmdbId),
    staleTime: 30 * 60_000,
  });

  const target = discover.data?.addTarget;
  const arrReady = Boolean(target?.exists && target?.id)
    && (target?.service === 'radarr' ? canSeeMovies : canSeeSeries);
  const instanceQuery = target?.instanceId ? `?instanceId=${encodeURIComponent(target.instanceId)}` : '';

  const arr = useQuery({
    queryKey: ['jellyfin', 'catalog', 'arr-ratings', target?.service, target?.instanceId, target?.id],
    queryFn: jsonFetcher<RadarrMovie | SonarrSeries>(`/api/${target?.service}/${target?.id}${instanceQuery}`),
    enabled: arrReady,
    staleTime: 30 * 60_000,
  });

  const items: RatingItem[] = target?.service === 'radarr'
    ? movieRatingItems((arr.data as RadarrMovie | undefined)?.ratings)
    : seriesRatingItems((arr.data as SonarrSeries | undefined)?.ratings);

  if (items.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1">
          <Star className={`size-3 ${item.color}`} />
          <span className="text-sm font-semibold">{item.score}</span>
          <span className="text-[10px] text-muted-foreground">{item.label}</span>
          {item.votes > 0 && (
            <span className="text-[9px] text-muted-foreground/60">{formatRatingVotes(item.votes)}</span>
          )}
        </span>
      ))}
    </div>
  );
}
