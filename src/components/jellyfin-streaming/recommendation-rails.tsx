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
import { RankedTile } from '@/components/jellyfin-streaming/cinematic/ranked-tile';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
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

/**
 * The engine's own ranked list is the only honest source for a Top 10 row —
 * Helprr has no popularity chart, and dressing an arbitrary rail in numerals
 * would make the number mean nothing.
 */
const RANKED_RAIL_ID = 'top-picks';
const RANKED_LIMIT = 10;

/**
 * The fewest surviving items a type-filtered rail may keep.
 *
 * Narrowing a mixed rail to one medium can leave it with two entries, and a
 * two-card row reads as broken rather than as a short recommendation.
 */
const MIN_FILTERED_ITEMS = 6;

export function RecommendationRails({ limit = 6, mediaType }: {
  limit?: number;
  /**
   * Keep only titles of one medium. The Movies and TV hubs are single-medium
   * screens, and the engine's rails are mixed — an unfiltered "Because you
   * watched" on the Movies page recommends series.
   */
  mediaType?: 'movie' | 'tv';
}) {
  const canSee = useCan('recommendations.view');
  const cinematic = useWatchSkin() === 'cinematic';
  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'recommendation-rails'],
    queryFn: jsonFetcher<RecommendationsResponse>('/api/recommendations'),
    enabled: canSee,
    staleTime: 10 * 60_000,
  });

  const rails = (query.data?.rails ?? [])
    .filter((rail) => !ALREADY_ON_HOME.has(rail.id))
    .map((rail) => (mediaType
      ? { ...rail, items: rail.items.filter((item) => item.mediaType === mediaType) }
      : rail))
    .filter((rail) => rail.items.length >= (mediaType ? MIN_FILTERED_ITEMS : 1))
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
      {rails.map((rail) => {
        const ranked = cinematic && rail.id === RANKED_RAIL_ID;
        const items = ranked ? rail.items.slice(0, RANKED_LIMIT) : rail.items;
        return (
          <MediaRail
            key={rail.id}
            title={ranked ? `Top ${items.length} on your server` : rail.title}
            reason={ranked ? null : rail.reason}
            count={items.length}
          >
            {items.map((item, index) => (
              <RecTile
                key={item.itemKey}
                item={item}
                rank={ranked ? index + 1 : undefined}
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
        );
      })}
    </>
  );
}

function RecTile({
  item,
  watch,
  queue,
  requested,
  rank,
}: {
  item: RecItem;
  /** Set on the ranked row; draws the oversized numeral beside the poster. */
  rank?: number;
  watch?: ReturnType<ReturnType<typeof useWatchLookup>>;
  queue?: ArrQueueState;
  requested: boolean;
}) {
  const hint = item.source === 'anilist' ? 'anilist' : 'tmdb';
  const poster = toCachedImageSrc(item.posterUrl, hint);
  // The engine already carries a backdrop; the tile uses it whenever it
  // resolves to a 16:9 frame, which on cinematic is every desktop rail.
  const backdrop = toCachedImageSrc(item.backdropUrl, hint);
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

  const tile = {
    title: item.title,
    imageUrl: poster,
    landscapeUrl: backdrop,
    href: item.href,
    unoptimized: poster ? isProtectedApiImageSrc(poster) : true,
    lines: [
      [item.year, typeof item.rating === 'number' && item.rating > 0 ? `★ ${item.rating.toFixed(1)}` : null]
        .filter(Boolean)
        .join(' · '),
    ],
    // The popover shows genres the way the site shows its mood tags; the
    // year/rating line stays the classic skin's caption.
    tags: item.genres.slice(0, 3),
    topLeftBadge,
    bottomLeftBadge,
    watched: played,
    progressPct: progress,
  };

  if (rank != null) return <RankedTile rank={rank} {...tile} />;
  return <MediaTile {...tile} />;
}
