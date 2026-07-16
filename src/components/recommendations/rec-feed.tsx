'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useInfiniteQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Bookmark, Clapperboard, Film, HardDriveDownload, Heart, Loader2, Share2, Sparkles, Star, Tv, X } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { isProtectedApiImageSrc } from '@/lib/image';
import { useCan } from '@/components/permission-provider';
import { WatchlistAddDialog } from '@/components/watchlist/watchlist-add-dialog';
import type { FeedResponse, RecItem } from '@/lib/recommendations/rec-types';
import { backdropSrcOf, posterSrcOf, watchlistDraftOf } from './rec-card';
import type { RecEventTracker } from './use-rec-events';

// Full-screen vertical feed (TikTok / YouTube Shorts style): every card fills
// the viewport below the sticky toolbar, the page snaps one card at a time,
// and the media is edge-to-edge with info + a right-hand action rail overlaid.
// Trailers play inline by swapping the media for a YouTube embed (CSP already
// allows www.youtube.com frames).

// Viewport height minus the mobile header + sticky mode toolbar (--header-height
// is 0 at md+, where only the toolbar sits above the feed).
const CARD_HEIGHT = 'h-[calc(100dvh-var(--header-height,0px)-58px)] md:h-[calc(100dvh-78px)]';
const CARD_SNAP_MARGIN = 'scroll-mt-[calc(var(--header-height,0px)+58px)] md:scroll-mt-[78px]';

interface RecFeedProps {
  tracker: RecEventTracker;
}

function ActionButton({ label, onClick, active, pop, children }: {
  label: string;
  onClick: () => void;
  active?: boolean;
  /** Play the TikTok-style pop animation (used by the like button). */
  pop?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      onClick={onClick}
      className={`flex h-11 w-11 items-center justify-center rounded-full bg-black/40 backdrop-blur-md transition-colors ${
        active ? 'text-red-400' : 'text-white/90 hover:text-white'
      } ${pop ? 'animate-[like-pop_0.35s_ease-out]' : ''}`}
    >
      {children}
    </button>
  );
}

function FeedCard({ item, position, tracker, onHide }: {
  item: RecItem;
  position: number;
  tracker: RecEventTracker;
  onHide: (itemKey: string) => void;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [liked, setLiked] = useState(false);
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [trailerKey, setTrailerKey] = useState<string | null>(null);
  const [trailerLoading, setTrailerLoading] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const canWatchlist = useCan('watchlist.edit');
  const watchlistDraft = watchlistDraftOf(item);
  const canTrailer = Boolean(item.tmdbId);
  // Under ~this length two clamped lines already show everything.
  const overviewExpandable = (item.overview?.length ?? 0) > 120;

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          tracker.impression(item, 'feed', position, 'feed');
          observer.disconnect();
          return;
        }
      }
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [item, position, tracker]);

  const media = backdropSrcOf(item) ?? posterSrcOf(item, 780);

  const playTrailer = async () => {
    if (trailerLoading || trailerKey) return;
    setTrailerLoading(true);
    try {
      const res = await fetch(`/api/recommendations/trailer?itemKey=${encodeURIComponent(item.itemKey)}`);
      const data = (await res.json()) as { youtubeKey?: string | null };
      if (data.youtubeKey) {
        setTrailerKey(data.youtubeKey);
        tracker.event('play', item, 'feed', 'feed');
      } else {
        toast.info('No trailer available');
      }
    } catch {
      // no trailer — leave the media as-is
    } finally {
      setTrailerLoading(false);
    }
  };

  const shareItem = async () => {
    const url = `${window.location.origin}${item.href}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: item.title, url });
      } else {
        await navigator.clipboard.writeText(url);
        toast.success('Link copied');
      }
    } catch {
      // user dismissed the share sheet
    }
  };

  if (trailerKey) {
    return (
      <div ref={ref} className={`relative flex w-full snap-start flex-col justify-center bg-black ${CARD_HEIGHT} ${CARD_SNAP_MARGIN}`}>
        <div className="aspect-video w-full">
          <iframe
            src={`https://www.youtube.com/embed/${trailerKey}?autoplay=1&playsinline=1&rel=0`}
            title={`${item.title} trailer`}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            className="h-full w-full"
          />
        </div>
        <div className="absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-3 py-3">
          <Link
            href={item.href}
            onClick={() => tracker.event('click', item, 'feed', 'feed')}
            className="min-w-0 truncate text-sm font-semibold text-white"
          >
            {item.title}
          </Link>
          <button
            type="button"
            aria-label="Close trailer"
            onClick={() => setTrailerKey(null)}
            className="shrink-0 rounded-full bg-black/40 p-2 text-white/80 backdrop-blur-md hover:text-white"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className={`relative w-full snap-start overflow-hidden ${CARD_HEIGHT} ${CARD_SNAP_MARGIN}`}>
      <Link href={item.href} onClick={() => tracker.event('click', item, 'feed', 'feed')} className="absolute inset-0 block">
        {media ? (
          <Image
            src={media}
            alt={item.title}
            fill
            sizes="100vw"
            className="object-cover"
            unoptimized={isProtectedApiImageSrc(media)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center bg-muted text-muted-foreground">
            {item.mediaType === 'movie' ? <Film className="h-10 w-10" /> : <Tv className="h-10 w-10" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-black/25" />
      </Link>

      {/* Info overlay — bottom-left, clear of the action rail. */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 p-3 pb-5">
        <div className="min-w-0 flex-1 pr-1">
          {item.reason && (
            // The chip must be its own block box: as a plain inline inside a
            // truncating <p>, the parent's overflow clipping cuts the pill's
            // rounded corners and backdrop-blur fragments across line boxes.
            <p className="text-xs font-semibold text-white/95">
              <span className="inline-flex max-w-full items-center rounded-full bg-primary/25 px-2.5 py-1 ring-1 ring-white/25 backdrop-blur-md">
                <span className="truncate">{item.reason}</span>
              </span>
            </p>
          )}
          <h3 className="mt-1.5 text-xl font-bold leading-tight text-white drop-shadow">{item.title}</h3>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-white/85">
            {item.matchPct != null && (
              <span className="font-semibold text-[#46d369]">{item.matchPct}% match</span>
            )}
            {item.year != null && <span>{item.year}</span>}
            {item.rating != null && item.rating > 0 && (
              <span className="inline-flex items-center gap-1">
                <Star className="h-3 w-3 text-yellow-400 fill-yellow-400" />
                {item.rating.toFixed(1)}
              </span>
            )}
            {item.genres.length > 0 && <span className="truncate">{item.genres.slice(0, 3).join(' · ')}</span>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-1.5">
            {item.owned && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                <HardDriveDownload className="h-3 w-3" /> On your server
              </span>
            )}
            {item.exploration && (
              <span className="inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-medium text-white backdrop-blur">
                <Sparkles className="h-3 w-3 text-amber-300" /> Something different
              </span>
            )}
          </div>
          {item.overview && (overviewExpandable ? (
            <button
              type="button"
              aria-expanded={overviewExpanded}
              onClick={() => setOverviewExpanded((v) => !v)}
              className="pointer-events-auto mt-1.5 block max-w-xl text-left"
            >
              {/* line-clamp sets display:-webkit-box — adding `block` would override it. */}
              <span
                className={`text-xs leading-snug text-white/80 ${
                  overviewExpanded
                    ? 'block -mx-2 rounded-lg bg-black/45 px-2 py-1.5 backdrop-blur-md'
                    : 'line-clamp-2'
                }`}
              >
                {item.overview}
                {overviewExpanded && <span className="ml-1 font-semibold text-white">less</span>}
              </span>
              {!overviewExpanded && <span className="text-xs font-semibold text-white">more</span>}
            </button>
          ) : (
            <p className="mt-1.5 max-w-xl text-xs leading-snug text-white/75">{item.overview}</p>
          ))}
        </div>

        {/* Action rail — TikTok-style vertical stack, bottom-right. */}
        <div className="pointer-events-auto flex shrink-0 flex-col items-center gap-2.5">
          <ActionButton
            label="More like this"
            active={liked}
            pop={liked}
            onClick={() => {
              if (liked) return;
              setLiked(true);
              tracker.event('like', item, 'feed', 'feed');
            }}
          >
            <Heart className={`h-5 w-5 ${liked ? 'fill-red-400' : ''}`} />
          </ActionButton>
          {canWatchlist && watchlistDraft && (
            <ActionButton label="Add to watchlist" onClick={() => setWatchlistOpen(true)}>
              <Bookmark className="h-5 w-5" />
            </ActionButton>
          )}
          {canTrailer && (
            <ActionButton label="Watch trailer" onClick={() => void playTrailer()}>
              {trailerLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : <Clapperboard className="h-5 w-5" />}
            </ActionButton>
          )}
          <ActionButton label="Share" onClick={() => void shareItem()}>
            <Share2 className="h-5 w-5" />
          </ActionButton>
          <ActionButton
            label="Not interested"
            onClick={() => {
              tracker.event('not_interested', item, 'feed', 'feed');
              onHide(item.itemKey);
            }}
          >
            <Ban className="h-5 w-5" />
          </ActionButton>
        </div>
      </div>

      {watchlistDraft && (
        <WatchlistAddDialog
          open={watchlistOpen}
          onOpenChange={setWatchlistOpen}
          draft={watchlistDraft}
          onSaved={() => tracker.event('watchlist_add', item, 'feed', 'feed')}
        />
      )}
    </div>
  );
}

/** Infinite vertical feed over /api/recommendations/feed. */
export function RecFeed({ tracker }: RecFeedProps) {
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const sentinel = useRef<HTMLDivElement | null>(null);

  // One-card-at-a-time paging: the window scroller snaps while (and only
  // while) the feed is mounted.
  useEffect(() => {
    const root = document.documentElement;
    const previous = root.style.scrollSnapType;
    root.style.scrollSnapType = 'y mandatory';
    return () => {
      root.style.scrollSnapType = previous;
    };
  }, []);

  const feedQuery = useInfiniteQuery({
    queryKey: ['recommendations-feed'],
    queryFn: ({ pageParam }) =>
      jsonFetcher<FeedResponse>(`/api/recommendations/feed${pageParam ? `?cursor=${encodeURIComponent(pageParam)}` : ''}`)(),
    initialPageParam: '',
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    staleTime: 5 * 60 * 1000,
  });

  const items = useMemo(() => {
    // Dedupe across pages: a snapshot rebuild between cursors can overlap, and
    // duplicate keys would crash React's reconciliation.
    const seen = new Set<string>();
    const out: RecItem[] = [];
    for (const page of feedQuery.data?.pages ?? []) {
      for (const item of page.items) {
        if (seen.has(item.itemKey) || hiddenKeys.has(item.itemKey)) continue;
        seen.add(item.itemKey);
        out.push(item);
      }
    }
    return out;
  }, [feedQuery.data, hiddenKeys]);

  useEffect(() => {
    const node = sentinel.current;
    if (!node) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && feedQuery.hasNextPage && !feedQuery.isFetchingNextPage) {
        void feedQuery.fetchNextPage();
      }
    }, { rootMargin: '1200px' });
    observer.observe(node);
    return () => observer.disconnect();
  }, [feedQuery]);

  if (feedQuery.isLoading) {
    return (
      <div className="py-24 text-center text-muted-foreground">
        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
      </div>
    );
  }
  if (items.length === 0) {
    return (
      <div className="py-24 text-center text-sm text-muted-foreground">
        Nothing to show yet — watch a few things and check back.
      </div>
    );
  }

  return (
    <div className="w-full">
      {items.map((item, position) => (
        <FeedCard
          key={item.itemKey}
          item={item}
          position={position}
          tracker={tracker}
          onHide={(key) => setHiddenKeys((prev) => new Set(prev).add(key))}
        />
      ))}
      <div ref={sentinel} className="h-px snap-start" />
      {feedQuery.isFetchingNextPage && (
        <div className="py-4 text-center text-muted-foreground">
          <Loader2 className="mx-auto h-5 w-5 animate-spin" />
        </div>
      )}
      {!feedQuery.hasNextPage && (
        <p className="py-4 text-center text-xs text-muted-foreground">You&apos;re all caught up.</p>
      )}
    </div>
  );
}
