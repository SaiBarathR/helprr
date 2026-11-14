'use client';

import Link from '@/components/ui/app-link';
import { useEffect, useState } from 'react';
import { Info, Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { Button } from '@/components/ui/button';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinBackdropUrl, jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
import { CinematicHero } from '@/components/jellyfin-streaming/cinematic/cinematic-hero';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { formatCertificate, formatCommunityRating } from '@/lib/jellyfin-playback/metadata';
import { formatClock, ticksToSeconds } from '@/lib/jellyfin-playback/device';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/skeleton';

const ROTATE_MS = 10_000;

/**
 * Home spotlight, modelled on the reference install's Media Bar: a full-bleed
 * backdrop, the title's own logo art where it exists, and one dominant Play.
 *
 * Trailer playback (the reference has `EnableTrailers`) is deliberately out of
 * scope here — this is the layout, not the video layer.
 */
interface WatchHeroProps {
  items: JellyfinItem[];
  onPlay: (item: JellyfinItem) => void;
  /**
   * Whether the spotlight is still being fetched.
   *
   * Empty means two different things — not here yet, and this library has no
   * billboard title — and they need opposite treatment: hold the space, or
   * take none at all. Without the distinction a library with no spotlight
   * would shimmer forever.
   */
  pending?: boolean;
}

/** Skin switch — see use-watch-skin. */
export function WatchHero(props: WatchHeroProps) {
  const skin = useWatchSkin();
  if (skin === 'cinematic') return <CinematicHero {...props} />;
  return <ClassicHero {...props} />;
}

function ClassicHero({ items, onPlay, pending }: WatchHeroProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const count = items.length;
    if (paused || count < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [paused, items.length]);

  // Same reservation as the cinematic billboard: rendering nothing put the
  // rails at the top of the page and then pushed them down when the hero
  // landed. The box matches the section below it, negative insets included.
  if (items.length === 0 && !pending) return null;
  if (items.length === 0) {
    return (
      <div
        aria-hidden
        className="relative -mx-[var(--main-pad-x)] -mt-[var(--main-pad-top)] mb-2 h-[62vh] min-h-[22rem] overflow-hidden"
      >
        <Skeleton className="h-full w-full rounded-none" />
      </div>
    );
  }
  const item = items[Math.min(index, items.length - 1)]!;
  // Every slide stays mounted in a fixed order. Keying one <img> on the item
  // reset its load state and flashed the shimmer; mounting only a moving window
  // reordered the DOM, and reordered nodes drop their CSS transition. A stable
  // list of five layers is the only version that actually crossfades. Widths are
  // capped below 1920 to keep five backdrops affordable.
  const layers = items;

  return (
    <section
      aria-label="Featured"
      className="relative -mx-[var(--main-pad-x)] -mt-[var(--main-pad-top)] mb-2 h-[62vh] min-h-[22rem] overflow-hidden"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {layers.map((slide, slideIndex) => {
        const src = jellyfinBackdropUrl(slide, 1280);
        if (!src) return null;
        return (
          <span
            key={slide.Id}
            aria-hidden={slideIndex !== index}
            className={cn(
              'absolute inset-0 transition-opacity duration-700 motion-reduce:transition-none',
              slideIndex === index ? 'opacity-100' : 'opacity-0',
            )}
          >
            <FadeInImage
              src={src}
              alt=""
              fill
              sizes="100vw"
              priority={slideIndex === 0}
              unoptimized
              className="object-cover"
            />
          </span>
        );
      })}
      {/* Black-based scrims only, per the project's image-scrim convention. */}
      <span className="absolute inset-0 bg-gradient-to-t from-background from-30% via-background/80 via-60% to-transparent" />
      <span className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/20 to-transparent" />

      <div className="relative flex h-full flex-col justify-end gap-3 p-[var(--main-pad-x)] pb-6 md:pb-8">
        <div className="max-w-xl space-y-3">
          {/* Every slide's copy — logo, details, overview — stays mounted too,
              stacked in one grid cell, and crossfades with its backdrop on the
              same 0.7 s. Switched on its own, the text changed at the instant
              of rotation and sat under the outgoing title's logo and art for
              most of the fade; one title swapping its logo's src also fetched
              the new logo only then (the image route answers no-cache), so it
              popped in late. The cell takes the tallest slide's copy, so the
              buttons under it hold still. */}
          <div className="grid">
            {layers.map((slide, slideIndex) => {
              const runtime = ticksToSeconds(slide.RunTimeTicks) > 0 ? formatClock(ticksToSeconds(slide.RunTimeTicks)) : null;
              const certificate = formatCertificate(slide.OfficialRating);
              const rating = formatCommunityRating(slide.CommunityRating);
              return (
                <div
                  key={slide.Id}
                  aria-hidden={slideIndex !== index}
                  className={cn(
                    'space-y-3 self-end [grid-area:1/1] transition-opacity duration-700 motion-reduce:transition-none',
                    slideIndex === index ? 'opacity-100' : 'opacity-0',
                  )}
                >
                  <HeroTitle
                    name={slide.Name}
                    logoUrl={slide.ImageTags?.Logo ? jellyfinImageUrl(slide.Id, 'Logo', 640) : null}
                    // Mounted, if hidden, from the first paint, where opacity
                    // does not defer a lazy image: the later slides' logos must
                    // not compete with the backdrop and page actually on screen.
                    fetchPriority={slideIndex === index ? undefined : 'low'}
                    as="p"
                    frameClassName="h-16 w-56 md:h-20 md:w-72"
                    textClassName="text-3xl font-semibold tracking-tight text-balance md:text-4xl"
                  />

                  <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    {certificate && (
                      <span className="rounded border border-current px-1.5 py-px text-[11px] font-medium tracking-wide">
                        {certificate}
                      </span>
                    )}
                    <span>
                      {[slide.ProductionYear, runtime, rating, slide.Genres?.slice(0, 2).join(', ')]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </div>

                  {slide.Overview && (
                    <p className="line-clamp-3 max-w-lg text-sm text-muted-foreground">{slide.Overview}</p>
                  )}
                </div>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button size="lg" className="rounded-full px-6" onClick={() => onPlay(item)}>
              <Play className="fill-current" data-icon="inline-start" />
              Play
            </Button>
            <Button size="lg" variant="secondary" className="rounded-full px-5" asChild>
              <Link href={`/jellyfin/library/item/${item.Id}`}>
                <Info data-icon="inline-start" />
                More info
              </Link>
            </Button>
          </div>
        </div>

        {items.length > 1 && (
          <div className="flex gap-1.5">
            {items.map((slide, slideIndex) => (
              <button
                key={slide.Id}
                type="button"
                aria-label={`Show ${slide.Name}`}
                aria-current={slideIndex === index ? 'true' : undefined}
                onClick={() => setIndex(slideIndex)}
                className={cn(
                  // Each dot's hit area is 44px tall and takes half of the gap on
                  // either side, so the dots share one strip without overlapping.
                  "relative h-1.5 rounded-full transition-all after:absolute after:-inset-x-[3px] after:top-1/2 after:h-11 after:-translate-y-1/2 after:content-['']",
                  slideIndex === index ? 'w-6 bg-foreground' : 'w-1.5 bg-foreground/35 hover:bg-foreground/60',
                )}
              />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
