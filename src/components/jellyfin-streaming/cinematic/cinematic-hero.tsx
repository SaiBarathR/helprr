'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { Info, Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';
import { jsonFetcher } from '@/lib/query-fetch';
import { Button } from '@/components/ui/button';
import { TrailerBackdrop } from '@/components/jellyfin-streaming/cinematic/trailer-backdrop';
import { useWatchModal } from '@/components/jellyfin-streaming/cinematic/watch-modal';
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

  return (
    <section
      aria-label="Featured"
      className="relative -mx-[var(--main-pad-x)] -mt-[var(--main-pad-top)] mb-2 h-[80vh] min-h-[26rem] overflow-hidden"
    >
      <TrailerBackdrop
        backdropUrl={backdrop}
        trailerUrl={detail.data?.item?.RemoteTrailers?.[0]?.Url}
        enabled
        priority
        // Stacked above the maturity flag on desktop rather than beside it —
        // the flag's width varies with the rating, so side-by-side either
        // collides or needs a magic offset. A phone is too narrow for the
        // toggle and the CTAs on one line, so there it moves to the top
        // corner, where the streaming apps put it on mobile anyway.
        controlsClassName="absolute top-4 right-[var(--main-pad-x)] md:top-auto md:bottom-28"
      />

      {/* Black-based scrims only, per the project's image-scrim convention. */}
      <span className="absolute inset-0 bg-gradient-to-t from-background from-12% via-background/70 via-52% to-transparent" />
      <span className="absolute inset-0 bg-gradient-to-r from-background/90 via-background/25 to-transparent" />

      <div className="relative flex h-full flex-col justify-end gap-4 p-[var(--main-pad-x)] pb-10 md:pb-16">
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
            <Button size="lg" className="rounded-sm px-7 text-base font-semibold" onClick={() => onPlay(item)}>
              <Play className="fill-current" data-icon="inline-start" />
              Play
            </Button>
            <Button
              size="lg"
              variant="secondary"
              className="rounded-sm px-6 text-base font-semibold backdrop-blur-sm"
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
        <div className="absolute right-0 bottom-10 flex items-center gap-3 md:bottom-16">
          <span className="border-l-2 border-white/60 bg-black/40 py-1 pr-[var(--main-pad-x)] pl-3 text-sm text-white">
            {certificate}
            {runtime && <span className="ml-2 text-white/70">{runtime}</span>}
          </span>
        </div>
      )}

    </section>
  );
}
