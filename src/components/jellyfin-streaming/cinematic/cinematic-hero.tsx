'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Check, Megaphone, Play, Plus } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';
import { jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { FadeInImage } from '@/components/media/fade-in-image';
import { PreviewBackdrop } from '@/components/jellyfin-streaming/cinematic/preview-backdrop';
import { useWatchModal } from '@/components/jellyfin-streaming/cinematic/watch-modal';
import { useHoverPreviewActive } from '@/components/jellyfin-streaming/cinematic/hover-preview-slot';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { useFavoriteToggle } from '@/components/jellyfin-streaming/cinematic/use-favorite-toggle';
import { sampleWashColor, washGradient } from '@/lib/jellyfin-playback/ambient-color';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { jellyfinBackdropUrl, jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { formatCertificate, formatRuntimeShort, isRecentlyAdded } from '@/lib/jellyfin-playback/metadata';
import { ticksToSeconds } from '@/lib/jellyfin-playback/device';

/**
 * The billboard.
 *
 * Deliberately different from the classic spotlight in three ways, all of them
 * things every streaming service does and a media manager doesn't: it fills
 * the viewport rather than sitting in a 62vh band, it does not rotate or show
 * pagination dots, and it plays a muted trailer over the art after a beat.
 *
 * Only the first spotlight title is used. Netflix's billboard is one title —
 * rotation is a Prime Video idiom, and it fights with trailer playback.
 */
export function CinematicHero({
  items,
  onPlay,
}: {
  items: JellyfinItem[];
  onPlay: (item: JellyfinItem) => void;
}) {
  const item = items[0];
  const modal = useWatchModal();
  const compact = useCompactViewport();
  const hoverPreviewActive = useHoverPreviewActive();
  const [washColor, setWashColor] = useState<string | null>(null);

  // Trailers are not in the home payload's field set, so they cost one extra
  // request — fired only for the single billboard title.
  const detail = useQuery({
    queryKey: ['jellyfin', 'catalog', 'hero-trailer', item?.Id],
    queryFn: jsonFetcher<CatalogItemDetailResponse>(
      `/api/jellyfin/catalog/items/${item?.Id}?expand=trailers`,
    ),
    enabled: Boolean(item?.Id),
    staleTime: 30 * 60_000,
  });

  // Phones show a portrait card, so the wash has to come from the poster —
  // sampling the backdrop would tint the page from art that is never on screen.
  const backdropForWash = item
    ? (compact ? (jellyfinPosterUrl(item, 480) ?? jellyfinBackdropUrl(item, 640)) : jellyfinBackdropUrl(item, 640))
    : null;
  useEffect(() => {
    if (!backdropForWash) return undefined;
    let cancelled = false;
    // A small copy of the same artwork; the browser has it cached by the time
    // the billboard has painted, so this costs nothing extra in practice.
    void sampleWashColor(backdropForWash).then((color) => {
      if (!cancelled) setWashColor(color);
    });
    return () => { cancelled = true; };
  }, [backdropForWash]);

  if (!item) return null;

  const backdrop = jellyfinBackdropUrl(item, 1920);
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 720) : null;
  const certificate = formatCertificate(item.OfficialRating);
  const recentlyAdded = isRecentlyAdded(item.DateCreated);
  // Type, first genre, year, then a runtime — or a season count, because a
  // series carries no runtime of its own and rendering the raw ticks printed
  // "1m" under a whole show.
  const heroSeasons = item.Type === 'Series' ? (item.ChildCount ?? 0) : 0;
  const billboardFacts = [
    item.Type === 'Series' ? 'Series' : item.Type === 'Movie' ? 'Film' : null,
    item.Genres?.[0] ?? null,
    item.ProductionYear ? String(item.ProductionYear) : null,
    heroSeasons > 0
      ? `${heroSeasons} Season${heroSeasons === 1 ? '' : 's'}`
      : formatRuntimeShort(ticksToSeconds(item.RunTimeTicks)),
    certificate,
  ].filter((fact): fact is string => Boolean(fact));

  // The ambient wash is not a desktop flourish — the app tints its phone home
  // from the hero art too, green on Home, red on Movies, teal on Shows. It has
  // to be rendered before the compact branch returns, which is exactly where
  // it was missing.
  const wash = washColor && (
    <div
      aria-hidden
      className="pointer-events-none absolute top-0 -z-10 h-[110vh] max-h-[56rem]"
      style={{
        left: 'calc(-1 * var(--main-pad-x))',
        right: 'calc(-1 * var(--main-pad-x))',
        background: washGradient(washColor),
      }}
    />
  );

  if (compact) {
    return (
      <>
        {wash}
        <CompactHero item={item} onPlay={onPlay} />
      </>
    );
  }

  return (
    <>
      {/* A radial gradient in a colour taken from this title's artwork,
          anchored above the top edge and gone by 65%. The site rebuilds this
          per title — it is why the whole page reads as lit by the hero rather
          than pasted on a flat ground. Full-bleed, so it escapes the shell's
          content inset. */}
      {wash}

    <section
      aria-label="Featured"
      // An inset rounded card, not a full-bleed banner: netflix.com measures a
      // 1344x616 billboard inside a 1440 viewport with a 24px radius and a
      // 48px inset. The full-bleed square version this replaced is the older
      // design. hpr-cine-billboard opts out of the scope's card-radius sweep
      // so the larger hero radius survives.
      className="hpr-cine-billboard relative mb-9 h-[68vh] max-h-[42rem] min-h-[24rem] overflow-hidden rounded-3xl"
    >
      <PreviewBackdrop
        backdropUrl={backdrop}
        itemId={item.Id}
        runtimeTicks={item.RunTimeTicks}
        trailerUrl={detail.data?.item?.RemoteTrailers?.[0]?.Url}
        enabled
        // Two previews at once is both noisy and a second transcode, so the
        // billboard stands down for the overlay and for a card being hovered.
        paused={(modal?.isOpen ?? false) || hoverPreviewActive}
        priority
        // Above the status chip on desktop; a phone is too narrow for the
        // toggle and the CTAs on one line, so there it moves to the top
        // corner, where the streaming apps put it on mobile anyway.
        controlsClassName="absolute top-4 right-4 md:top-auto md:right-9 md:bottom-[6.5rem]"
      />

      {/* Black-based scrims only, per the project's image-scrim convention.
          These are load-bearing, not decoration: library artwork is not
          curated for text overlay the way a streaming service's is, and a
          light backdrop (a pale poster, a snow scene) left the title and
          synopsis sitting on near-white with no contrast at all. The
          left-to-right ramp is the one the site relies on, and it is opaque
          enough here to carry any artwork. */}
      {/* Measured from the site, and much lighter than the near-black ramps
          this replaced: 0.6 alpha gone by 60% across, 0.5 gone by 70% up. The
          artwork is meant to stay visible; the wash behind carries the mood. */}
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(90deg, rgba(0,0,0,0.6) 0%, rgba(0,0,0,0) 60%)' }}
      />
      <span
        aria-hidden
        className="absolute inset-0"
        style={{ background: 'linear-gradient(0deg, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.1) 35%, rgba(0,0,0,0) 70%)' }}
      />

      {/* The site's scrims are tuned for curated key art with a dark left
          third. A Jellyfin library has no such guarantee, so legibility is
          bought from the type rather than by darkening the artwork further —
          which would lose the very thing the scrims are keeping visible. */}
      <div
        className="relative flex h-full flex-col justify-end gap-4 p-6 pb-8 md:p-9 md:pb-12"
        style={{ textShadow: '0 1px 12px rgba(0,0,0,0.85), 0 1px 3px rgba(0,0,0,0.9)' }}
      >
        <div className="max-w-[36rem] space-y-4">
          <HeroTitle
            name={item.Name}
            logoUrl={logo}
            as="p"
            frameClassName="h-20 w-64 md:h-28 md:w-[26rem]"
            textClassName="text-4xl font-bold tracking-tight text-balance md:text-6xl"
          />

          {/* The site's billboard fact line, measured: type, first genre, year,
              runtime, certificate — dot-separated, directly above the synopsis.
              It replaced the bordered flag that used to hang off the right
              edge, which is the pre-redesign treatment. */}
          {billboardFacts.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium text-white/90">
              {billboardFacts.map((fact, index) => (
                <span key={fact} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden className="text-white/45">&bull;</span>}
                  {fact}
                </span>
              ))}
            </p>
          )}

          {item.Overview && (
            <p className="line-clamp-3 max-w-[30rem] text-sm text-white/90 md:text-base">{item.Overview}</p>
          )}

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              size="lg"
              className="h-12 rounded-full px-6 text-lg font-medium"
              onClick={() => onPlay(item)}
            >
              <Play className="fill-current" data-icon="inline-start" />
              Play
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="h-12 rounded-full px-6 text-lg font-medium backdrop-blur-sm"
              asChild
            >
              <Link
                href={`/jellyfin/library/item/${item.Id}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (modal?.open(item.Id)) event.preventDefault();
                }}
              >
                {/* No glyph: the site's secondary billboard button is a plain
                    grey pill reading "More Info". */}
                More Info
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Status chips at the foot, where the site carries "Recently added"
          and its Top 10 rank. Helprr has no ranking of its own, so only the
          recency chip is real; inventing a rank would be a lie about what the
          number means. */}
      {recentlyAdded && (
        <div className="absolute right-9 bottom-8 flex items-center gap-3 md:bottom-12">
          <span className="flex items-center gap-1.5 rounded-sm bg-[#e50914] px-2 py-1 text-[13px] font-semibold text-white">
            <Megaphone className="size-4" />
            Recently added
          </span>
        </div>
      )}

    </section>
    </>
  );
}

/**
 * The phone hero: a portrait poster card, not a wide billboard.
 *
 * The Netflix app inset-cards its hero at roughly 24px with a 12px radius,
 * overlays the title treatment, a dot-separated genre line and a Play / My
 * List pair, and lets the page ground pick up an ambient wash from the art.
 * A 16:9 billboard scaled down is a different (and worse) thing, so the phone
 * gets its own composition rather than a reflow of the desktop one.
 *
 * No preview video here: the app does not autoplay on its hero card either,
 * and a phone is the worst place to spend a transcode.
 */
function CompactHero({
  item,
  onPlay,
}: {
  item: JellyfinItem;
  onPlay: (item: JellyfinItem) => void;
}) {
  const favorite = useFavoriteToggle(item.Id, item.UserData?.IsFavorite ?? false);
  const poster = jellyfinPosterUrl(item, 720) ?? jellyfinBackdropUrl(item, 720);
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 640) : null;
  const tags = [
    item.Type === 'Series' ? 'Series' : item.Type === 'Movie' ? 'Film' : item.Type,
    ...(item.Genres ?? []).slice(0, 3),
  ].filter(Boolean);

  return (
    <section aria-label="Featured" className="mx-2 mb-6">
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-xl bg-white/5">
        {poster && (
          <FadeInImage src={poster} alt="" fill sizes="100vw" priority unoptimized className="object-cover" />
        )}
        {/* The app stamps its mark in the hero card's top-left corner. */}
        <span
          aria-hidden
          className="absolute top-3 left-3 z-10 text-2xl font-extrabold tracking-[-0.06em] text-[#e50914] drop-shadow-[0_1px_4px_rgba(0,0,0,0.8)]"
        >
          H
        </span>
        {/* Heavy, because the overlay lands on whatever the poster happens to
            put there — often its own title. Netflix relies on curated key art
            for the same overlap; a denser scrim is the honest substitute. */}
        <span className="absolute inset-x-0 bottom-0 h-2/5 bg-gradient-to-t from-black from-40% via-black/85 via-70% to-transparent" />

        <div className="absolute inset-x-0 bottom-0 space-y-3 p-4">
          {/* No title treatment over a poster. Portrait key art almost always
              has the title designed into it — overlaying a logo on top prints
              it twice, which is why the Netflix app shows only the genre line
              here. The text fallback stays for art that has no title at all. */}
          {!poster && (
            <HeroTitle
              name={item.Name}
              logoUrl={logo}
              align="center"
              as="p"
              frameClassName="mx-auto h-16 w-56"
              textClassName="text-center text-2xl font-bold tracking-tight text-balance"
            />
          )}

          {tags.length > 0 && (
            <p className="flex flex-wrap items-center justify-center gap-x-2 gap-y-1 text-[13px] font-medium text-white/90">
              {tags.map((tag, index) => (
                <span key={tag} className="flex items-center gap-2">
                  {index > 0 && <span aria-hidden className="text-white/40">•</span>}
                  {tag}
                </span>
              ))}
            </p>
          )}

          <div className="flex items-center gap-2">
            <Button
              className="h-11 flex-1 rounded font-semibold"
              onClick={() => onPlay(item)}
            >
              <Play className="fill-current" data-icon="inline-start" />
              Play
            </Button>
            {/* The app's phone hero is Play plus "+ My List" — More Info is
                the desktop billboard's second button, not this one. */}
            <Button
              variant="secondary"
              className="h-11 flex-1 rounded font-semibold"
              onClick={() => favorite.toggle()}
              aria-pressed={favorite.isFavorite}
            >
              {favorite.isFavorite
                ? <Check data-icon="inline-start" strokeWidth={3} />
                : <Plus data-icon="inline-start" />}
              My List
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
