'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Ban, Bookmark, ExternalLink, Film, HardDriveDownload, Heart, Sparkles, Star, Tv } from 'lucide-react';
import { QuickContextMenu, type ContextAction } from '@/components/ui/quick-context-menu';
import { WatchlistAddDialog, type WatchlistDraft } from '@/components/watchlist/watchlist-add-dialog';
import { useCan } from '@/components/permission-provider';
import { isProtectedApiImageSrc, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import type { RecItem } from '@/lib/recommendations/rec-types';
import type { RecEventMode, RecEventTracker } from './use-rec-events';

export function imageHintOf(item: RecItem): ImageServiceHint {
  if (item.source === 'tmdb') return 'tmdb';
  if (item.source === 'anilist') return 'anilist';
  return item.mediaType === 'movie' ? 'radarr' : 'sonarr';
}

/** Map a recommendation item onto the shared watchlist add flow. */
export function watchlistDraftOf(item: RecItem): WatchlistDraft | null {
  if (item.mediaType === 'anime' && item.anilistId) {
    return {
      source: 'ANILIST',
      externalId: String(item.anilistId),
      mediaType: 'anime',
      title: item.title,
      year: item.year,
      // Jellyfin-proxied art is session-scoped; only pass portable URLs.
      posterUrl: item.posterUrl?.startsWith('http') ? item.posterUrl : null,
      overview: item.overview,
      rating: item.rating,
    };
  }
  if (item.tmdbId && (item.mediaType === 'movie' || item.mediaType === 'tv')) {
    return {
      source: 'TMDB',
      externalId: String(item.tmdbId),
      mediaType: item.mediaType === 'tv' ? 'series' : 'movie',
      title: item.title,
      year: item.year,
      posterUrl: item.posterUrl?.startsWith('http') ? item.posterUrl : null,
      overview: item.overview,
      rating: item.rating,
    };
  }
  return null;
}

export function posterSrcOf(item: RecItem, width?: number): string | null {
  if (!item.posterUrl) return null;
  return toCachedImageSrc(item.posterUrl, imageHintOf(item), width ? { width } : undefined) ?? item.posterUrl;
}

export function backdropSrcOf(item: RecItem): string | null {
  if (!item.backdropUrl) return null;
  return toCachedImageSrc(item.backdropUrl, imageHintOf(item), { width: 1280 }) ?? item.backdropUrl;
}

interface RecCardProps {
  item: RecItem;
  railId: string;
  position: number;
  mode: RecEventMode;
  tracker: RecEventTracker;
  /** Optimistic local removal after "Not interested". */
  onNotInterested: (itemKey: string) => void;
}

/** Poster card used inside rails: impression-tracked, with a long-press/right-
 * click menu for feedback. The whole card is a link to the title's page. */
export function RecCard({ item, railId, position, mode, tracker, onNotInterested }: RecCardProps) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const canWatchlist = useCan('watchlist.edit');
  const watchlistDraft = watchlistDraftOf(item);

  // Impression = at least half the card visible once.
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          tracker.impression(item, railId, position, mode);
          observer.disconnect();
          return;
        }
      }
    }, { threshold: 0.5 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [item, railId, position, mode, tracker]);

  const poster = posterSrcOf(item, 360);
  const progress = item.watch?.progressPct ?? null;
  const episodeProgress = item.watch && item.watch.totalEpisodes
    ? Math.round(((item.watch.watchedEpisodes ?? 0) / item.watch.totalEpisodes) * 100)
    : null;
  const bar = progress ?? episodeProgress;

  const actions: ContextAction[] = [
    {
      id: 'open',
      label: 'Open details',
      icon: <ExternalLink className="h-4 w-4" />,
      href: item.href,
    },
    {
      id: 'like',
      label: 'More like this',
      icon: <Heart className="h-4 w-4" />,
      onSelect: () => tracker.event('like', item, railId, mode),
    },
    ...(canWatchlist && watchlistDraft ? [{
      id: 'watchlist',
      label: 'Add to watchlist',
      icon: <Bookmark className="h-4 w-4" />,
      onSelect: () => setWatchlistOpen(true),
    } satisfies ContextAction] : []),
    {
      id: 'not-interested',
      label: 'Not interested',
      icon: <Ban className="h-4 w-4" />,
      onSelect: () => {
        tracker.event('not_interested', item, railId, mode);
        onNotInterested(item.itemKey);
      },
    },
  ];

  return (
    <QuickContextMenu label={`Actions for ${item.title}`} actions={actions}>
      <div ref={ref} className="group w-[116px] shrink-0 md:w-[150px]">
        <Link
          href={item.href}
          onClick={() => tracker.event('click', item, railId, mode)}
          className="block"
        >
          <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-muted ring-1 ring-border transition-transform duration-200 group-hover:scale-[1.03]">
            {poster ? (
              <Image
                src={poster}
                alt={item.title}
                fill
                sizes="(max-width: 768px) 116px, 150px"
                className="object-cover"
                unoptimized={isProtectedApiImageSrc(poster)}
              />
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                {item.mediaType === 'movie' ? <Film className="h-8 w-8" /> : <Tv className="h-8 w-8" />}
              </div>
            )}
            <div className="absolute left-1 top-1 flex flex-col gap-1">
              {item.owned && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-background/75 px-1.5 py-0.5 text-[10px] font-semibold text-primary backdrop-blur">
                  <HardDriveDownload className="h-3 w-3" />
                </span>
              )}
              {item.exploration && (
                <span
                  className="inline-flex items-center rounded-full bg-background/75 px-1.5 py-0.5 text-[10px] font-semibold text-amber-400 backdrop-blur"
                  title="Something different"
                >
                  <Sparkles className="h-3 w-3" />
                </span>
              )}
            </div>
            {item.rating != null && item.rating > 0 && (
              <span className="absolute right-1 top-1 inline-flex items-center gap-0.5 rounded-full bg-background/75 px-1.5 py-0.5 text-[10px] font-medium text-foreground backdrop-blur">
                <Star className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {bar != null && bar > 0 && bar < 100 && (
              <div className="absolute inset-x-0 bottom-0 h-1 bg-background/60">
                <div className="h-full bg-primary" style={{ width: `${bar}%` }} />
              </div>
            )}
          </div>
          <div className="mt-1.5 space-y-0.5 px-0.5">
            <p className="truncate text-xs font-medium leading-tight">{item.title}</p>
            <p className="truncate text-[11px] text-muted-foreground">
              {item.matchPct != null && (
                <span className="mr-1.5 font-semibold text-[#46d369]">{item.matchPct}% match</span>
              )}
              {item.reason ?? (item.year != null ? String(item.year) : '')}
            </p>
          </div>
        </Link>
        {watchlistDraft && (
          <WatchlistAddDialog
            open={watchlistOpen}
            onOpenChange={setWatchlistOpen}
            draft={watchlistDraft}
            onSaved={() => tracker.event('watchlist_add', item, railId, mode)}
          />
        )}
      </div>
    </QuickContextMenu>
  );
}
