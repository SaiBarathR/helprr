'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Play, RotateCcw } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PageSpinner } from '@/components/ui/page-spinner';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { PreviewBackdrop } from '@/components/jellyfin-streaming/cinematic/preview-backdrop';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinBackdropUrl, jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { formatCertificate, formatCommunityRating } from '@/lib/jellyfin-playback/metadata';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';

interface WatchModalApi {
  /**
   * Opens the detail overlay, or returns false when the caller should just
   * navigate — classic skin, small screens, or before hydration settles.
   */
  open: (itemId: string) => boolean;
  /** True while the overlay is up, so the page behind can pause its preview. */
  isOpen: boolean;
}

const WatchModalContext = createContext<WatchModalApi | null>(null);

/**
 * Netflix's tiles open a card *over* the row rather than navigating away, so
 * you never lose your place in the grid. This is that, without intercepting
 * routes.
 *
 * Interception was the obvious tool and the wrong one: a parallel `@modal`
 * slot rewrites the URL while the `children` slot keeps rendering the previous
 * page, which is only correct if the overlay ALWAYS renders. The skin is a
 * client preference, so on a classic-skin load the slot would render nothing
 * and leave a stale page under a changed URL. Driving it from state instead
 * keeps classic navigation completely untouched.
 *
 * The URL still updates — `history.pushState` is supported by the App Router
 * for shallow updates and keeps `usePathname` in sync — so the address bar,
 * the back button and a refresh (which lands on the real page) all behave.
 */
export function WatchModalProvider({ children }: { children: React.ReactNode }) {
  const [itemId, setItemId] = useState<string | null>(null);
  /**
   * Whether our own history entry is still on the stack.
   *
   * This has to be a ref read in an event handler, not state read inside a
   * setState updater: an updater is meant to be pure, React may invoke it
   * twice in development, and the history.back() it used to contain simply
   * never ran — the overlay closed with the item URL left in the address bar.
   */
  const pushedRef = useRef(false);

  const open = useCallback((nextId: string) => {
    // Phones navigate. Netflix's own app does the same — a modal on a 375px
    // viewport is just a worse full page, and it fights the back gesture.
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 768px)').matches) {
      return false;
    }
    setItemId(nextId);
    window.history.pushState(null, '', `/jellyfin/library/item/${nextId}`);
    pushedRef.current = true;
    return true;
  }, []);

  const close = useCallback(() => {
    setItemId(null);
    // Pop the entry we pushed so the URL returns to the browse page. Guarded
    // so a stray close can't walk the user's history backwards.
    if (pushedRef.current) {
      pushedRef.current = false;
      window.history.back();
    }
  }, []);

  // Back/forward closes the overlay, whichever direction it came from — and
  // the entry is gone either way, so it must not be popped again on close.
  useEffect(() => {
    const onPopState = () => {
      pushedRef.current = false;
      setItemId(null);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  const api = useMemo<WatchModalApi>(() => ({ open, isOpen: itemId !== null }), [open, itemId]);

  return (
    <WatchModalContext.Provider value={api}>
      {children}
      <WatchDetailModal itemId={itemId} onClose={close} />
    </WatchModalContext.Provider>
  );
}

/**
 * Returns the overlay opener, or null outside the Watch section. Callers fall
 * back to plain navigation when it returns null or when `open` returns false.
 */
export function useWatchModal(): WatchModalApi | null {
  return useContext(WatchModalContext);
}

function WatchDetailModal({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const playback = useJellyfinPlayback();
  const query = useQuery({
    // Same key the full detail page uses, so opening the overlay after
    // visiting the page (or vice versa) is instant.
    queryKey: queryKeys.jellyfinItem(itemId ?? '', 'full'),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(
      `/api/jellyfin/catalog/items/${itemId}?expand=seasons,episodes,similar,trailers`,
    ),
    enabled: Boolean(itemId),
  });

  const item = query.data?.item;
  const backdrop = item ? jellyfinBackdropUrl(item, 1920) : null;
  // Season and episode lead with the *series* identity, as the full detail
  // page does: series logo up top, the specific episode as a subtitle.
  const isChildOfSeries = item?.Type === 'Season' || item?.Type === 'Episode';
  const seriesId = isChildOfSeries ? (item?.SeriesId ?? item?.ParentId) : undefined;
  const heroName = (isChildOfSeries ? item?.SeriesName : item?.Name) ?? item?.Name ?? '';
  const heroSubtitle = item?.Type === 'Season'
    ? item.Name
    : item?.Type === 'Episode'
      ? [item.ParentIndexNumber != null && item.IndexNumber != null
          ? `S${item.ParentIndexNumber}:E${item.IndexNumber}`
          : null, item.Name].filter(Boolean).join(' · ')
      : null;
  const logoOwnerId = item?.ImageTags?.Logo ? item.Id : seriesId;
  const logo = logoOwnerId ? jellyfinImageUrl(logoOwnerId, 'Logo', 720) : null;
  const runtimeSeconds = ticksToSeconds(item?.RunTimeTicks);
  const resumeSeconds = ticksToSeconds(item?.UserData?.PlaybackPositionTicks);
  const certificate = formatCertificate(item?.OfficialRating);
  const rating = formatCommunityRating(item?.CommunityRating);

  return (
    <Dialog open={Boolean(itemId)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton
        className="hpr-watch max-h-[92vh] min-w-0 gap-0 overflow-x-hidden overflow-y-auto p-0 sm:max-w-3xl"
      >
        {!item ? (
          <div className="min-h-64">
            <DialogTitle className="sr-only">Loading title</DialogTitle>
            <PageSpinner />
          </div>
        ) : (
          <>
            {/* Explicit height, not aspect-video: DialogContent is a grid, and a
                stretched grid item ignores aspect-ratio for its height — the
                hero grew to thousands of pixels and pushed the title and CTAs
                off-screen. A viewport-relative height also matches the
                proportions these services actually use for a detail card. */}
            <div className="relative h-[42vh] max-h-[26rem] min-h-[14rem] w-full shrink-0 overflow-hidden">
              <PreviewBackdrop
                backdropUrl={backdrop}
                itemId={item.Id}
                runtimeTicks={item.RunTimeTicks}
                trailerUrl={item.RemoteTrailers?.[0]?.Url}
                enabled
                priority
                controlsClassName="absolute right-4 bottom-4"
              />
              <span className="absolute inset-0 bg-gradient-to-t from-background via-background/40 to-transparent" />

              <div className="absolute inset-x-0 bottom-0 space-y-3 p-5">
                <DialogTitle asChild>
                  <div className="min-w-0">
                    <HeroTitle
                      name={heroName}
                      logoUrl={logo}
                      frameClassName="h-14 w-48 md:h-16 md:w-64"
                      textClassName="text-2xl font-bold tracking-tight md:text-3xl"
                    />
                    {heroSubtitle && (
                      <p className="mt-1 truncate text-sm font-medium text-white/85">{heroSubtitle}</p>
                    )}
                  </div>
                </DialogTitle>

                <div className="flex flex-wrap items-center gap-2">
                  {!item.IsFolder && (
                    <Button
                      className="rounded-sm px-6 font-semibold"
                      onClick={() => void playback.playItem(item)}
                    >
                      {resumeSeconds > 0 ? <RotateCcw data-icon="inline-start" /> : <Play className="fill-current" data-icon="inline-start" />}
                      {resumeSeconds > 0 ? 'Resume' : 'Play'}
                    </Button>
                  )}
                  <Button variant="secondary" className="rounded-sm" asChild>
                    <Link href={`/jellyfin/library/item/${item.Id}`}>
                      <ExternalLink data-icon="inline-start" />
                      Full details
                    </Link>
                  </Button>
                </div>
              </div>
            </div>

            <div className="min-w-0 space-y-4 p-5">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                {certificate && (
                  <span className="rounded-sm border border-current px-1.5 py-px text-[11px] font-medium tracking-wide">
                    {certificate}
                  </span>
                )}
                <span>
                  {[
                    item.ProductionYear,
                    runtimeSeconds > 0 ? formatClock(runtimeSeconds) : null,
                    rating,
                  ].filter(Boolean).join(' · ')}
                </span>
              </div>

              {item.Overview && (
                <p className="text-sm leading-relaxed break-words">{item.Overview}</p>
              )}

              {(item.Genres?.length ?? 0) > 0 && (
                <p className="text-xs text-muted-foreground">
                  <span className="text-foreground/70">Genres: </span>
                  {item.Genres!.join(', ')}
                </p>
              )}

              {query.data?.episodes && query.data.episodes.length > 0 && (
                <CatalogRail
                  shape="landscape"
                  title="Episodes"
                  items={query.data.episodes}
                  onPlay={(next) => void playback.playItem(next)}
                />
              )}

              {query.data?.similar && query.data.similar.length > 0 && (
                <CatalogRail
                  shape="landscape"
                  title="More like this"
                  items={query.data.similar}
                  onPlay={(next) => void playback.playItem(next)}
                />
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
