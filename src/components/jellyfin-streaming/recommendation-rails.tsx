'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { useRequestedMedia } from '@/components/seerr/requested-media-provider';
import { useWatchLookup } from '@/components/jellyfin/watch-status-provider';
import { isFullyWatched } from '@/types/watch-status';
import { useArrQueueLookup, type ArrQueueState } from '@/components/jellyfin-streaming/use-arr-queue-lookup';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';
import { MediaTile, type TileBadge } from '@/components/jellyfin-streaming/media-tile';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { RecommendationsResponse } from '@/lib/recommendations/rec-types';
import type { RecItem } from '@/lib/recommendations/rec-types';

/**
 * Recommendation rails from Helprr's own engine rather than Jellyfin's.
 *
 * Jellyfin's `/Movies/Recommendations` returned the same handful of titles for
 * every "Because you watched" baseline, so six rails showed identical content.
 * Helprr's engine already blends Jellyfin history, Playback Reporting, AniList
 * and the watchlist, and it knows whether a title is `owned` — so the rails are
 * both distinct and able to mark what is already in the library.
 */
/**
 * Rails the Watch home already renders from Jellyfin directly. The engine emits
 * its own versions, which would show the same row twice.
 */
const ALREADY_ON_HOME = new Set(['continue-watching', 'next-up', 'favorites']);

export function RecommendationRails({ limit = 6 }: { limit?: number }) {
  const canSee = useCan('recommendations.view');
  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'recommendation-rails'],
    queryFn: jsonFetcher<RecommendationsResponse>('/api/recommendations'),
    enabled: canSee,
    staleTime: 10 * 60_000,
  });

  const rails = (query.data?.rails ?? [])
    .filter((rail) => rail.items.length > 0 && !ALREADY_ON_HOME.has(rail.id))
    .slice(0, limit);

  // Three cross-app signals, resolved once for the whole set of rails: what
  // Jellyfin says you have watched, what is downloading in arr right now, and
  // what you have already requested through Seerr.
  const watchLookup = useWatchLookup(rails.length > 0);
  const queueLookup = useArrQueueLookup();
  const requested = useRequestedMedia(rails.length > 0);

  if (!canSee || rails.length === 0) return null;

  return (
    <>
      {rails.map((rail) => (
        <MediaRail key={rail.id} title={rail.title} reason={rail.reason} count={rail.items.length}>
          {rail.items.map((item) => (
            <RecTile
              key={item.itemKey}
              item={item}
              watch={watchLookup({ tmdbId: item.tmdbId, anilistId: item.anilistId })}
              queue={queueLookup(item.arr)}
              requested={
                item.tmdbId && (item.mediaType === 'movie' || item.mediaType === 'tv')
                  ? requested.isRequested(item.mediaType, item.tmdbId)
                  : false
              }
            />
          ))}
        </MediaRail>
      ))}
    </>
  );
}

function RecTile({
  item,
  watch,
  queue,
  requested,
}: {
  item: RecItem;
  watch?: ReturnType<ReturnType<typeof useWatchLookup>>;
  queue?: ArrQueueState;
  requested: boolean;
}) {
  const poster = toCachedImageSrc(item.posterUrl, item.source === 'anilist' ? 'anilist' : 'tmdb');
  // The watch-status overlay is authoritative — it accounts for every leaf
  // episode — so prefer it over the snapshot baked into the rec item.
  const played = watch ? isFullyWatched(watch) : Boolean(item.watch?.played);
  const progress = watch?.kind === 'movie' ? watch.playedPercentage : item.watch?.progressPct;

  // Owned vs discoverable is the distinction the reference draws, and Helprr's
  // engine already knows which is which.
  const topLeftBadge: TileBadge = item.owned
    ? { label: 'In library', tone: 'green' }
    : {
        label: item.mediaType === 'movie' ? 'Movie' : item.mediaType === 'tv' ? 'Series' : 'Anime',
        tone: 'blue',
      };
  const bottomLeftBadge: TileBadge | undefined = queue
    ? { label: `${Math.round(queue.progressPct)}%`, tone: 'amber' }
    : requested && !item.owned
      ? { label: 'Requested', tone: 'purple' }
      : undefined;

  return (
    <MediaTile
      title={item.title}
      imageUrl={poster}
      href={item.href}
      unoptimized={poster ? isProtectedApiImageSrc(poster) : true}
      lines={[
        [item.year, typeof item.rating === 'number' && item.rating > 0 ? `★ ${item.rating.toFixed(1)}` : null]
          .filter(Boolean)
          .join(' · '),
      ]}
      topLeftBadge={topLeftBadge}
      bottomLeftBadge={bottomLeftBadge}
      watched={played}
      progressPct={progress}
    />
  );
}
