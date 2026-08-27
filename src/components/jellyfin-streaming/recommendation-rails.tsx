'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import { useRequestedMedia } from '@/components/seerr/requested-media-provider';
import { useWatchLookup } from '@/components/jellyfin/watch-status-provider';
import { isFullyWatched } from '@/types/watch-status';
import { useArrQueueLookup, type ArrQueueState } from '@/components/jellyfin-streaming/use-arr-queue-lookup';
import { FadeInImage } from '@/components/media/fade-in-image';
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
        <section key={rail.id} className="space-y-2">
          <div className="flex items-baseline gap-2">
            <h2 className="text-base font-semibold tracking-tight">{rail.title}</h2>
            {rail.reason && <p className="truncate text-[11px] text-muted-foreground">{rail.reason}</p>}
          </div>
          <div className="animate-rail-in flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-[var(--main-pad-x)] px-[var(--main-pad-x)]">
            {rail.items.map((item) => (
              <RecCard
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
          </div>
        </section>
      ))}
    </>
  );
}

function RecCard({
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

  return (
    <div className="group relative w-[110px] shrink-0 sm:w-[140px] md:w-[150px] lg:w-[164px] xl:w-[180px] 2xl:w-[196px]">
      <div className="relative aspect-2/3 overflow-hidden rounded-xl border border-border/40 bg-muted/60">
        {poster ? (
          <FadeInImage
            src={poster}
            alt={item.title}
            fill
            sizes="196px"
            unoptimized={isProtectedApiImageSrc(poster)}
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.title}
          </div>
        )}
        <span className="pointer-events-none absolute inset-0 z-20 bg-black/0 transition-colors group-hover:bg-black/35" />

        {/* Owned vs discoverable is the distinction the reference draws, and
            Helprr's engine already knows which is which. */}
        {item.owned ? (
          <span className="absolute top-2 left-2 z-20 rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--hpr-green)] uppercase backdrop-blur-md">
            In library
          </span>
        ) : (
          <span className="absolute top-2 left-2 z-20 rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--hpr-blue)] uppercase backdrop-blur-md">
            {item.mediaType === 'movie' ? 'Movie' : item.mediaType === 'tv' ? 'Series' : 'Anime'}
          </span>
        )}
        {played && (
          <span className="absolute top-2 right-2 z-20 flex size-5 items-center justify-center rounded-full border border-white/15 bg-black/45 text-[var(--hpr-green)] backdrop-blur-md">
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
        {queue ? (
          <span className="absolute bottom-2 left-2 z-20 rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--hpr-amber)] backdrop-blur-md">
            {Math.round(queue.progressPct)}%
          </span>
        ) : requested && !item.owned ? (
          <span className="absolute bottom-2 left-2 z-20 rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--hpr-purple)] uppercase backdrop-blur-md">
            Requested
          </span>
        ) : null}
        {typeof progress === 'number' && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 z-20 h-1.5 bg-black/45 backdrop-blur-sm">
            <div className="h-full bg-[var(--hpr-amber)]" style={{ width: `${progress}%` }} />
          </div>
        )}
      </div>

      <p className="mt-2 truncate text-sm font-medium">{item.title}</p>
      <p className="truncate text-[11px] text-muted-foreground">
        {[item.year, typeof item.rating === 'number' && item.rating > 0 ? `★ ${item.rating.toFixed(1)}` : null]
          .filter(Boolean).join(' · ')}
      </p>

      <Link href={item.href} aria-label={item.title} className="absolute inset-0 z-10 rounded-xl focus-visible:ring-2 focus-visible:ring-[var(--hpr-amber)] focus-visible:outline-none" />
    </div>
  );
}
