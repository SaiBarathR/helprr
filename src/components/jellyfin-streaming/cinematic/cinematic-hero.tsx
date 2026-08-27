'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Info, Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';
import { jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { FadeInImage } from '@/components/media/fade-in-image';
import { PreviewBackdrop } from '@/components/jellyfin-streaming/cinematic/preview-backdrop';
import { useWatchModal } from '@/components/jellyfin-streaming/cinematic/watch-modal';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { jellyfinBackdropUrl, jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { formatCertificate } from '@/lib/jellyfin-playback/metadata';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';

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

  if (!item) return null;

  const backdrop = jellyfinBackdropUrl(item, 1920);
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 720) : null;
  const runtime = ticksToSeconds(item.RunTimeTicks) > 0 ? formatClock(ticksToSeconds(item.RunTimeTicks)) : null;
  const certificate = formatCertificate(item.OfficialRating);

  if (compact) {
    return (
      <CompactHero
        item={item}
        onPlay={onPlay}
        onMoreInfo={() => modal?.open(item.Id) ?? false}
      />
    );
  }

  return (
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
        // Two previews playing at once is both noisy and a second transcode.
        paused={modal?.isOpen ?? false}
        priority
        // Stacked above the maturity flag on desktop rather than beside it —
        // the flag's width varies with the rating, so side-by-side either
        // collides or needs a magic offset. A phone is too narrow for the
        // toggle and the CTAs on one line, so there it moves to the top
        // corner, where the streaming apps put it on mobile anyway.
        controlsClassName="absolute top-4 right-4 md:top-auto md:bottom-12 md:right-9"
      />

      {/* Black-based scrims only, per the project's image-scrim convention. */}
      <span className="absolute inset-0 bg-gradient-to-t from-background from-12% via-background/70 via-52% to-transparent" />
      <span className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/25 to-transparent" />

      <div className="relative flex h-full flex-col justify-end gap-4 p-6 pb-8 md:p-9 md:pb-12">
        <div className="max-w-xl space-y-4">
          <HeroTitle
            name={item.Name}
            logoUrl={logo}
            frameClassName="h-20 w-64 md:h-28 md:w-[26rem]"
            textClassName="text-4xl font-bold tracking-tight text-balance md:text-6xl"
          />

          {item.Overview && (
            <p className="line-clamp-3 max-w-lg text-sm text-white/85 md:text-base">{item.Overview}</p>
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
                <Info data-icon="inline-start" />
                More info
              </Link>
            </Button>
          </div>
        </div>
      </div>

      {/* Maturity flag on the right edge — billboard furniture every one of
          these services puts there. Sits below the mute toggle on mobile. */}
      {certificate && (
        <div className="absolute right-0 bottom-8 flex items-center gap-3 md:bottom-12">
          <span className="border-l-2 border-white/60 bg-black/40 py-1 pr-6 pl-3 text-sm text-white md:pr-9">
            {certificate}
            {runtime && <span className="ml-2 text-white/70">{runtime}</span>}
          </span>
        </div>
      )}

    </section>
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
  onMoreInfo,
}: {
  item: JellyfinItem;
  onPlay: (item: JellyfinItem) => void;
  onMoreInfo: () => boolean;
}) {
  const poster = jellyfinPosterUrl(item, 720) ?? jellyfinBackdropUrl(item, 720);
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 640) : null;
  const tags = [
    item.Type === 'Series' ? 'Series' : item.Type === 'Movie' ? 'Film' : item.Type,
    ...(item.Genres ?? []).slice(0, 3),
  ].filter(Boolean);

  return (
    <section aria-label="Featured" className="mb-6">
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-xl bg-white/5">
        {poster && (
          <FadeInImage src={poster} alt="" fill sizes="100vw" priority unoptimized className="object-cover" />
        )}
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
            <Button
              variant="secondary"
              className="h-11 flex-1 rounded font-semibold"
              asChild
            >
              <Link
                href={`/jellyfin/library/item/${item.Id}`}
                onClick={(event) => {
                  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  if (onMoreInfo()) event.preventDefault();
                }}
              >
                <Info data-icon="inline-start" />
                More info
              </Link>
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
