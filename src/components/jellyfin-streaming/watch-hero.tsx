'use client';

import Link from 'next/link';
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
}

/** Skin switch — see use-watch-skin. */
export function WatchHero(props: WatchHeroProps) {
  const skin = useWatchSkin();
  if (skin === 'cinematic') return <CinematicHero {...props} />;
  return <ClassicHero {...props} />;
}

function ClassicHero({ items, onPlay }: WatchHeroProps) {
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  useEffect(() => {
    const count = items.length;
    if (paused || count < 2) return undefined;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return undefined;
    const timer = window.setInterval(() => setIndex((current) => (current + 1) % count), ROTATE_MS);
    return () => window.clearInterval(timer);
  }, [paused, items.length]);

  if (items.length === 0) return null;
  const item = items[Math.min(index, items.length - 1)]!;
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 640) : null;
  // Every slide stays mounted in a fixed order. Keying one <img> on the item
  // reset its load state and flashed the shimmer; mounting only a moving window
  // reordered the DOM, and reordered nodes drop their CSS transition. A stable
  // list of five layers is the only version that actually crossfades. Widths are
  // capped below 1920 to keep five backdrops affordable.
  const layers = items;
  const runtime = ticksToSeconds(item.RunTimeTicks) > 0 ? formatClock(ticksToSeconds(item.RunTimeTicks)) : null;
  const certificate = formatCertificate(item.OfficialRating);
  const rating = formatCommunityRating(item.CommunityRating);

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
          <HeroTitle
            name={item.Name}
            logoUrl={logo}
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
              {[item.ProductionYear, runtime, rating, item.Genres?.slice(0, 2).join(', ')]
                .filter(Boolean)
                .join(' · ')}
            </span>
          </div>

          {item.Overview && (
            <p className="line-clamp-3 max-w-lg text-sm text-muted-foreground">{item.Overview}</p>
          )}

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
                  'h-1.5 rounded-full transition-all',
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
