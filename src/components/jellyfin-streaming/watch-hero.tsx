'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Info, Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { Button } from '@/components/ui/button';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinBackdropUrl, jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import { HeroTitle } from '@/components/jellyfin-streaming/hero-title';
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
export function WatchHero({
  items,
  onPlay,
}: {
  items: JellyfinItem[];
  onPlay: (item: JellyfinItem) => void;
}) {
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
  const backdrop = jellyfinBackdropUrl(item);
  const logo = item.ImageTags?.Logo ? jellyfinImageUrl(item.Id, 'Logo', 640) : null;
  const runtime = ticksToSeconds(item.RunTimeTicks) > 0 ? formatClock(ticksToSeconds(item.RunTimeTicks)) : null;
  const certificate = formatCertificate(item.OfficialRating);
  const rating = formatCommunityRating(item.CommunityRating);

  return (
    <section
      aria-label="Featured"
      className="relative -mx-4 -mt-4 mb-2 h-[62vh] min-h-[22rem] overflow-hidden md:-mx-6 md:-mt-6"
      onPointerEnter={() => setPaused(true)}
      onPointerLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      {backdrop && (
        <FadeInImage
          key={item.Id}
          src={backdrop}
          alt=""
          fill
          sizes="100vw"
          priority
          unoptimized
          className="object-cover"
        />
      )}
      {/* Black-based scrims only, per the project's image-scrim convention. */}
      <span className="absolute inset-0 bg-gradient-to-t from-background from-30% via-background/80 via-60% to-transparent" />
      <span className="absolute inset-0 bg-gradient-to-r from-background/85 via-background/20 to-transparent" />

      <div className="relative flex h-full flex-col justify-end gap-3 p-4 pb-6 md:p-6 md:pb-8">
        <div className="max-w-xl space-y-3">
          <HeroTitle
            name={item.Name}
            logoUrl={logo}
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
