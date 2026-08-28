'use client';

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Check, ChevronDown, Play, Plus, RotateCcw, ThumbsUp, X } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageSpinner } from '@/components/ui/page-spinner';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { PreviewBackdrop } from '@/components/jellyfin-streaming/cinematic/preview-backdrop';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinBackdropUrl, jellyfinCardImage, jellyfinImageUrl, jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { formatCertificate, formatCommunityRating } from '@/lib/jellyfin-playback/metadata';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogItemDetailResponse, CatalogItemsResponse } from '@/types/jellyfin-streaming';

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

function ModalSection({
  title,
  aside,
  children,
}: {
  title: string;
  /** Right-aligned control beside the heading — the season picker lives here. */
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="px-12 pb-8">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h3 className="text-2xl font-medium">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

/**
 * The season picker, as the site draws it: a bordered trigger carrying the
 * current season, and a dark panel listing every season with its episode
 * count. Deliberately not a native <select> — that renders the operating
 * system's own menu, which looks nothing like the rest of the panel.
 */
function SeasonPicker({
  seasons,
  activeId,
  onSelect,
}: {
  seasons: JellyfinItem[];
  activeId: string | null;
  onSelect: (id: string) => void;
}) {
  const active = seasons.find((entry) => entry.Id === activeId) ?? seasons[0];
  const label = (entry: JellyfinItem) =>
    entry.Name ?? (entry.IndexNumber != null ? `Season ${entry.IndexNumber}` : 'Season');

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="Season"
        className="flex shrink-0 items-center gap-3 rounded border border-white/40 bg-[#242424] px-4 py-2 text-lg font-medium text-white transition-colors hover:border-white focus-visible:outline-none data-[state=open]:border-white"
      >
        {active ? label(active) : 'Season'}
        <ChevronDown className="size-4 shrink-0 transition-transform data-[state=open]:rotate-180" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="end"
        // hpr-cine-flat opts the panel out of the app's glass material, the
        // same way the overlay itself does.
        className="hpr-cine-flat max-h-80 min-w-56 overflow-y-auto rounded-none border-white/15 p-0"
      >
        {seasons.map((entry) => (
          <DropdownMenuItem
            key={entry.Id}
            onSelect={() => onSelect(entry.Id)}
            className="cursor-pointer gap-2 px-4 py-2.5 text-base focus:bg-white/10"
          >
            <span className="font-semibold text-white">{label(entry)}</span>
            {typeof entry.ChildCount === 'number' && entry.ChildCount > 0 && (
              <span className="text-white/60">
                ({entry.ChildCount} Episode{entry.ChildCount === 1 ? '' : 's'})
              </span>
            )}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** One track in an album or playlist: number, title, runtime. */
function TrackRow({ track, index, onPlay }: { track: JellyfinItem; index: number; onPlay: () => void }) {
  const runtime = ticksToSeconds(track.RunTimeTicks);
  return (
    <li>
      <button
        type="button"
        onClick={onPlay}
        className="group/track flex w-full items-center gap-4 rounded px-2 py-3 text-left transition-colors hover:bg-white/5"
      >
        <span className="w-6 shrink-0 text-center text-sm text-white/70 group-hover/track:hidden">
          {track.IndexNumber ?? index}
        </span>
        <span className="hidden w-6 shrink-0 items-center justify-center group-hover/track:flex">
          <Play className="size-4 fill-white text-white" />
        </span>
        <span className="min-w-0 flex-1 truncate text-base">{track.Name}</span>
        {runtime > 0 && <span className="shrink-0 text-sm text-white/70">{formatClock(runtime)}</span>}
      </button>
    </li>
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
      `/api/jellyfin/catalog/items/${itemId}?expand=seasons,episodes,similar,trailers,children`,
    ),
    enabled: Boolean(itemId),
  });

  const item = query.data?.item;
  const similar = query.data?.similar ?? [];
  // The site never leaves this section out. When Jellyfin has no "similar"
  // for a title, same-genre neighbours keep the overlay's shape intact.
  const fallbackGenre = item?.Genres?.[0];
  const genreFallback = useQuery({
    queryKey: ['jellyfin', 'catalog', 'modal-similar-fallback', item?.Id, fallbackGenre],
    queryFn: jsonFetcher<CatalogItemsResponse>(
      `/api/jellyfin/catalog/items?recursive=true&includeItemTypes=${item?.Type === 'Movie' ? 'Movie' : 'Series'}`
      + `&genres=${encodeURIComponent(fallbackGenre ?? '')}&sortBy=CommunityRating&sortOrder=Descending&limit=12`,
    ),
    enabled: Boolean(itemId) && Boolean(fallbackGenre) && query.isSuccess && similar.length === 0,
    staleTime: 10 * 60_000,
  });
  const moreLikeThis = similar.length > 0
    ? similar
    : (genreFallback.data?.items ?? []).filter((entry) => entry.Id !== item?.Id);

  /**
   * The season picker is driven by `seasons`, never by the loaded episodes.
   *
   * The detail route returns *all* episodes for a Series but only the owning
   * season's for an Episode. Deriving the option list from those episodes
   * therefore worked on a series and silently produced a single option — so no
   * picker at all — on an episode, which is how a 23-season show ended up
   * without one.
   */
  const [seasonChoice, setSeasonChoice] = useState<{ id: string | null; seasonId: string | null }>({ id: null, seasonId: null });
  // Keyed on the item rather than reset in an effect: a fresh title starts on
  // its own season without a render-then-correct pass.
  const chosenSeasonId = seasonChoice.id === itemId ? seasonChoice.seasonId : null;
  const setSeason = (next: string) => setSeasonChoice({ id: itemId, seasonId: next });

  const seasons = useMemo(() => query.data?.seasons ?? [], [query.data?.seasons]);
  const payloadEpisodes = useMemo(() => query.data?.episodes ?? [], [query.data?.episodes]);
  // Episodes spanning more than one season mean the payload covers the whole
  // series, so switching season is a filter rather than a fetch.
  const payloadCoversAllSeasons = useMemo(
    () => new Set(payloadEpisodes.map((episode) => episode.ParentIndexNumber)).size > 1,
    [payloadEpisodes],
  );
  const defaultSeasonId = item?.Type === 'Season' ? item.Id : (item?.SeasonId ?? seasons[0]?.Id ?? null);
  const activeSeasonId = chosenSeasonId ?? defaultSeasonId;
  const activeSeasonNumber = seasons.find((entry) => entry.Id === activeSeasonId)?.IndexNumber ?? null;

  // Only when the payload cannot answer: an episode-rooted overlay switching to
  // a season it never loaded.
  const needsSeasonFetch = Boolean(activeSeasonId)
    && !payloadCoversAllSeasons
    && activeSeasonId !== defaultSeasonId;
  const seasonQuery = useQuery({
    queryKey: queryKeys.jellyfinItem(activeSeasonId ?? '', 'full'),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(
      `/api/jellyfin/catalog/items/${activeSeasonId}?expand=episodes`,
    ),
    enabled: needsSeasonFetch,
  });

  const seasonEpisodes = payloadCoversAllSeasons
    ? payloadEpisodes.filter((episode) => episode.ParentIndexNumber === activeSeasonNumber)
    : needsSeasonFetch
      ? (seasonQuery.data?.episodes ?? [])
      : payloadEpisodes;

  // Album tracks and collection members. The detail API already returns these
  // for a MusicAlbum, Playlist, BoxSet or Folder — the overlay simply never
  // rendered them, so an album opened with no tracks and nothing to play.
  const tracks = useMemo(() => query.data?.children ?? [], [query.data?.children]);

  const openFullDetails = () => {
    if (!item) return;
    // Close first: leaving the overlay mounted over the page it had just
    // navigated to was the "Full details does nothing" bug.
    onClose();
    router.push(`/jellyfin/library/item/${item.Id}`);
  };

  // Music is square-art media: an album has no backdrop of its own, and its
  // ParentId is the *artist*, so asking for a backdrop returned the artist's
  // — a non-null URL that 404s, which is why the panel opened black.
  const squareArt = item?.Type === 'MusicAlbum' || item?.Type === 'Audio' || item?.Type === 'MusicArtist';
  const cover = item ? jellyfinPosterUrl(item, 900) : null;
  const backdrop = item ? (jellyfinBackdropUrl(item, 1920) ?? jellyfinPosterUrl(item, 1280)) : null;
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
        // 850px wide with a 6px radius at a 1440 viewport, pinned near the top
        // rather than vertically centred — all measured from the site (the
        // panel sits at x=295 in a 1440 viewport: 295 + 850 + 295).
        //
        // hpr-cine-modal opts the panel out of the app's glass material. The
        // glass rule matches on [data-slot='dialog-content'] and outranked the
        // bg-[#181818] utility below, so the overlay rendered translucent with
        // the rails showing through it; the site's panel is flat #181818.
        // `flex flex-col` overrides DialogContent's own `grid`. It matters:
        // a stretched grid item ignores aspect-ratio for its height, so the
        // 16:9 hero collapsed and the metadata landed on top of it.
        // Deliberately NOT .hpr-watch. That class carries the Watch section's
        // *layout* — min-height:100dvh and position:relative for the ambient
        // wash — and putting it on a portalled dialog overrode Radix's
        // position:fixed, dropping the panel into normal flow at the foot of
        // the page where it was invisible. The palette does not need it: the
        // tokens live on the root, which the portal is still inside.
        className="hpr-cine-modal top-8 flex max-h-[calc(100vh-4rem)] w-[92vw] max-w-[850px] translate-y-0 flex-col gap-0 overflow-x-hidden overflow-y-auto rounded-[6px] border-0 bg-[#181818] p-0 shadow-2xl sm:max-w-[850px]"
      >
        {!item ? (
          <div className="min-h-64">
            <DialogTitle className="sr-only">Loading title</DialogTitle>
            <PageSpinner />
          </div>
        ) : (
          <>
            <div className="relative aspect-video w-full shrink-0 overflow-hidden rounded-t-[6px] bg-black">
              {squareArt ? (
                // A square cover cropped to 16:9 loses most of the artwork, so
                // it sits at its own aspect over a blurred copy of itself.
                <>
                  {cover && (
                    <FadeInImage
                      src={cover}
                      alt=""
                      fill
                      sizes="850px"
                      priority
                      unoptimized
                      className="scale-110 object-cover opacity-40 blur-2xl"
                    />
                  )}
                  {cover && (
                    <span className="absolute inset-0 flex items-center justify-center p-6">
                      <span className="relative aspect-square h-full overflow-hidden rounded shadow-2xl">
                        <FadeInImage src={cover} alt={item.Name} fill sizes="360px" priority unoptimized className="object-cover" />
                      </span>
                    </span>
                  )}
                </>
              ) : (
                <PreviewBackdrop
                  backdropUrl={backdrop}
                  itemId={item.IsFolder ? undefined : item.Id}
                  runtimeTicks={item.RunTimeTicks}
                  trailerUrl={item.RemoteTrailers?.[0]?.Url}
                  enabled
                  priority
                  controlsClassName="absolute right-12 bottom-8 border-2 size-[38px]"
                />
              )}
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
                  {(
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

            {seasonEpisodes.length > 0 && (
              <ModalSection
                title="Episodes"
                aside={seasons.length > 1 ? (
                  <SeasonPicker
                    seasons={seasons}
                    activeId={activeSeasonId}
                    onSelect={setSeason}
                  />
                ) : null}
              >
                <ul className="divide-y divide-white/10">
                  {seasonEpisodes.slice(0, 20).map((episode) => (
                    <EpisodeRow
                      key={episode.Id}
                      episode={episode}
                      onPlay={() => void playback.playItem(episode)}
                    />
                  ))}
                </ul>
              </ModalSection>
            )}

            {tracks.length > 0 && (
              <ModalSection title={item.Type === 'MusicAlbum' ? 'Tracks' : 'Titles'}>
                <ul className="divide-y divide-white/10">
                  {tracks.map((child, index) => (
                    <TrackRow
                      key={child.Id}
                      track={child}
                      index={index + 1}
                      onPlay={() => void playback.playItems(tracks, index)}
                    />
                  ))}
                </ul>
              </ModalSection>
            )}

            {moreLikeThis.length > 0 && (
              <ModalSection title="More Like This">
                {/* A grid, not a rail: the site changes shape inside the
                    overlay because there is no room to scroll one sideways. */}
                <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
                  {moreLikeThis.slice(0, 9).map((entry) => (
                    <CatalogPosterCard
                      key={entry.Id}
                      item={entry}
                      shape="landscape"
                      flat
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
