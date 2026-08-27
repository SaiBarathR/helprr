'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check, Play, Plus, RotateCcw, ThumbsUp, X } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { PageSpinner } from '@/components/ui/page-spinner';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { PreviewBackdrop } from '@/components/jellyfin-streaming/cinematic/preview-backdrop';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinBackdropUrl, jellyfinCardImage, jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { formatCertificate, formatCommunityRating } from '@/lib/jellyfin-playback/metadata';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import type { JellyfinItem } from '@/types/jellyfin';
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
 * The detail overlay: a card *over* the row, so you never lose your place.
 *
 * It deliberately does not touch history. An earlier version pushed the item's
 * URL so the back button would close it, and every path that also navigated —
 * "Full details" above all — left the stack inconsistent: the overlay stayed
 * mounted on top of the page it had just pushed, and closing it then popped
 * back past the browse page entirely. Treating it as a lightbox (Escape, the
 * close button, or a click outside) removes that whole class of bug. The one
 * path that navigates closes the overlay first.
 */
export function WatchModalProvider({ children }: { children: React.ReactNode }) {
  const [itemId, setItemId] = useState<string | null>(null);

  const open = useCallback((nextId: string) => {
    // Phones navigate. The Netflix app does the same — an overlay on a 375px
    // viewport is just a worse full page, and it fights the back gesture.
    if (typeof window === 'undefined' || !window.matchMedia('(min-width: 768px)').matches) {
      return false;
    }
    setItemId(nextId);
    return true;
  }, []);

  const close = useCallback(() => setItemId(null), []);

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

/** 38px circle, 2px white/50 border on a dark fill — measured from the site. */
function CircleButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick?: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex size-[38px] shrink-0 items-center justify-center rounded-full border-2 border-white/50 bg-[rgba(42,42,42,0.6)] text-white transition-colors hover:border-white"
    >
      {children}
    </button>
  );
}

function MetaFact({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <p className="text-sm leading-relaxed">
      <span className="text-[#777]">{label}: </span>
      <span className="text-white">{value}</span>
    </p>
  );
}

function ModalSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="px-12 pb-8">
      <h3 className="mb-4 text-2xl font-medium">{title}</h3>
      {children}
    </section>
  );
}

function WatchDetailModal({ itemId, onClose }: { itemId: string | null; onClose: () => void }) {
  const playback = useJellyfinPlayback();
  const router = useRouter();
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

  const openFullDetails = () => {
    if (!item) return;
    // Close first: leaving the overlay mounted over the page it had just
    // navigated to was the "Full details does nothing" bug.
    onClose();
    router.push(`/jellyfin/library/item/${item.Id}`);
  };

  const backdrop = item ? jellyfinBackdropUrl(item, 1920) : null;
  const isChildOfSeries = item?.Type === 'Season' || item?.Type === 'Episode';
  const seriesId = isChildOfSeries ? (item?.SeriesId ?? item?.ParentId) : undefined;
  const heroName = (isChildOfSeries ? item?.SeriesName : item?.Name) ?? item?.Name ?? '';
  const logoOwnerId = item?.ImageTags?.Logo ? item.Id : seriesId;
  const logo = logoOwnerId ? jellyfinImageUrl(logoOwnerId, 'Logo', 720) : null;

  const runtimeSeconds = ticksToSeconds(item?.RunTimeTicks);
  const resumeSeconds = ticksToSeconds(item?.UserData?.PlaybackPositionTicks);
  const certificate = formatCertificate(item?.OfficialRating);
  const rating = formatCommunityRating(item?.CommunityRating);
  const episodeLabel = item?.Type === 'Episode' && item.ParentIndexNumber != null && item.IndexNumber != null
    ? `S${item.ParentIndexNumber}:E${item.IndexNumber} · ${item.Name}`
    : null;

  const people = item?.People ?? [];
  const actors = people.filter((person) => person.Type === 'Actor').map((person) => person.Name).filter(Boolean);
  const directors = people.filter((person) => person.Type === 'Director').map((person) => person.Name).filter(Boolean);
  const progressPct = resumeSeconds > 0 && runtimeSeconds > 0
    ? Math.min(100, (resumeSeconds / runtimeSeconds) * 100)
    : 0;

  return (
    <Dialog open={Boolean(itemId)} onOpenChange={(next) => { if (!next) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        // 882px wide with a 6px radius at a 1440 viewport, pinned near the top
        // rather than vertically centred — all measured from the site.
        // `flex flex-col` overrides DialogContent's own `grid`. It matters:
        // a stretched grid item ignores aspect-ratio for its height, so the
        // 16:9 hero collapsed and the metadata landed on top of it.
        className="hpr-watch top-8 flex max-h-[calc(100vh-4rem)] w-[92vw] max-w-[882px] translate-y-0 flex-col gap-0 overflow-x-hidden overflow-y-auto rounded-[6px] border-0 bg-[#181818] p-0 shadow-2xl sm:max-w-[882px]"
      >
        {!item ? (
          <div className="min-h-64">
            <DialogTitle className="sr-only">Loading title</DialogTitle>
            <PageSpinner />
          </div>
        ) : (
          <>
            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-t-[6px] bg-black">
              <PreviewBackdrop
                backdropUrl={backdrop}
                itemId={item.IsFolder ? undefined : item.Id}
                runtimeTicks={item.RunTimeTicks}
                trailerUrl={item.RemoteTrailers?.[0]?.Url}
                enabled
                priority
                controlsClassName="absolute right-12 bottom-8 border-2 size-[38px]"
              />
              {/* The player fades into the panel rather than cutting off, which
                  is what keeps hero and metadata reading as one surface. */}
              <span className="absolute inset-x-0 bottom-0 h-1/2 bg-gradient-to-t from-[#181818] via-[#181818]/70 to-transparent" />

              <button
                type="button"
                onClick={onClose}
                aria-label="Close"
                className="absolute top-4 right-4 z-30 flex size-9 items-center justify-center rounded-full bg-[#181818] text-white transition-colors hover:bg-[#2a2a2a]"
              >
                <X className="size-5" />
              </button>

              <div className="absolute inset-x-0 bottom-0 z-20 space-y-4 px-12 pb-8">
                <DialogTitle asChild>
                  <div className="min-w-0">
                    <HeroTitle
                      name={heroName}
                      logoUrl={logo}
                      frameClassName="h-16 w-56 md:h-20 md:w-72"
                      textClassName="text-3xl font-bold tracking-tight md:text-4xl"
                    />
                  </div>
                </DialogTitle>

                {progressPct > 0 && (
                  <div className="flex items-center gap-3">
                    <span className="h-1 w-64 max-w-[50%] overflow-hidden rounded-full bg-white/30">
                      <span className="block h-full bg-[#e50914]" style={{ width: `${progressPct}%` }} />
                    </span>
                    <span className="text-sm text-white/85">
                      {formatClock(resumeSeconds)} of {formatClock(runtimeSeconds)}
                    </span>
                  </div>
                )}

                <div className="flex items-center gap-3">
                  {!item.IsFolder && (
                    <Button
                      className="h-11 rounded px-7 text-base font-semibold"
                      onClick={() => void playback.playItem(item)}
                    >
                      {resumeSeconds > 0
                        ? <RotateCcw data-icon="inline-start" />
                        : <Play className="fill-current" data-icon="inline-start" />}
                      {resumeSeconds > 0 ? 'Resume' : 'Play'}
                    </Button>
                  )}
                  <CircleButton label="Add to My List"><Plus className="size-5" /></CircleButton>
                  <CircleButton label="Rate"><ThumbsUp className="size-[18px]" /></CircleButton>
                </div>
              </div>
            </div>

            {/* 48px gutters and a 2fr / 1fr split, as measured. */}
            <div className="grid grid-cols-1 gap-x-7 gap-y-4 px-12 pt-6 pb-8 md:grid-cols-[2fr_1fr]">
              <div className="min-w-0 space-y-3">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="text-[#bcbcbc]">
                    {[item.ProductionYear, runtimeSeconds > 0 ? formatClock(runtimeSeconds) : null, rating]
                      .filter(Boolean).join('   ')}
                  </span>
                  {certificate && (
                    <span className="border border-white/40 px-1.5 py-px text-[13px] text-white/90">
                      {certificate}
                    </span>
                  )}
                  {item.UserData?.Played && (
                    <span className="inline-flex items-center gap-1 text-[13px] text-[var(--hpr-green)]">
                      <Check className="size-3.5" strokeWidth={3} /> Watched
                    </span>
                  )}
                </div>

                {episodeLabel && <p className="text-base font-semibold">{episodeLabel}</p>}
                {item.Overview && (
                  <p className="text-base leading-[26px] break-words">{item.Overview}</p>
                )}
              </div>

              <div className="min-w-0 space-y-2">
                <MetaFact label="Cast" value={actors.slice(0, 4).join(', ')} />
                <MetaFact label="Genres" value={(item.Genres ?? []).slice(0, 4).join(', ')} />
                <MetaFact
                  label="Studios"
                  value={(item.Studios ?? []).map((studio) => studio.Name).filter(Boolean).slice(0, 3).join(', ')}
                />
              </div>
            </div>

            {query.data?.episodes && query.data.episodes.length > 0 && (
              <ModalSection title="Episodes">
                <ul className="divide-y divide-white/10">
                  {query.data.episodes.slice(0, 12).map((episode) => (
                    <EpisodeRow
                      key={episode.Id}
                      episode={episode}
                      onPlay={() => void playback.playItem(episode)}
                    />
                  ))}
                </ul>
              </ModalSection>
            )}

            {query.data?.similar && query.data.similar.length > 0 && (
              <ModalSection title="More Like This">
                {/* A grid, not a rail: the site changes shape inside the
                    overlay because there is no room to scroll one sideways. */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {query.data.similar.slice(0, 9).map((similar) => (
                    <CatalogPosterCard
                      key={similar.Id}
                      item={similar}
                      shape="landscape"
                      className="w-full"
                      onPlay={(next) => void playback.playItem(next)}
                    />
                  ))}
                </div>
              </ModalSection>
            )}

            <ModalSection title={`About ${heroName}`}>
              <div className="space-y-2">
                <MetaFact label="Cast" value={actors.join(', ')} />
                <MetaFact label="Director" value={directors.join(', ')} />
                <MetaFact label="Genres" value={(item.Genres ?? []).join(', ')} />
                <MetaFact label="Maturity rating" value={certificate ?? ''} />
                <button
                  type="button"
                  onClick={openFullDetails}
                  className="pt-2 text-sm font-medium text-white/70 underline-offset-4 hover:text-white hover:underline"
                >
                  Open the full details page
                </button>
              </div>
            </ModalSection>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function EpisodeRow({ episode, onPlay }: { episode: JellyfinItem; onPlay: () => void }) {
  const still = jellyfinCardImage(episode, 400, 'landscape');
  const runtime = ticksToSeconds(episode.RunTimeTicks);
  const progress = episode.UserData?.PlayedPercentage;

  return (
    <li>
      <button
        type="button"
        onClick={onPlay}
        className="group/ep flex w-full items-center gap-4 rounded px-2 py-4 text-left transition-colors hover:bg-white/5"
      >
        <span className="w-6 shrink-0 text-center text-lg text-white/70">{episode.IndexNumber ?? ''}</span>
        <span className="relative aspect-video w-[132px] shrink-0 overflow-hidden rounded bg-white/5">
          {still && (
            <FadeInImage src={still} alt="" fill sizes="132px" unoptimized className="object-cover" />
          )}
          <span className="absolute inset-0 flex items-center justify-center bg-black/30 opacity-0 transition-opacity group-hover/ep:opacity-100">
            <Play className="size-6 fill-white text-white" />
          </span>
          {typeof progress === 'number' && progress > 0 && progress < 100 && (
            <span className="absolute inset-x-0 bottom-0 h-[3px] bg-white/30">
              <span className="block h-full bg-[#e50914]" style={{ width: `${progress}%` }} />
            </span>
          )}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-3">
            <span className="truncate text-base font-medium">{episode.Name}</span>
            {runtime > 0 && <span className="shrink-0 text-sm text-white/70">{formatClock(runtime)}</span>}
          </span>
          {episode.Overview && (
            <span className="mt-1 line-clamp-2 block text-sm text-[#bcbcbc]">{episode.Overview}</span>
          )}
        </span>
      </button>
    </li>
  );
}
