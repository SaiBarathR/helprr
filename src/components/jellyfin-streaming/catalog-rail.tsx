'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import type { CatalogCardShape } from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

export function CatalogRail({
  title,
  items,
  onPlay,
  href,
  shape = 'portrait',
  upcoming = false,
  subtitleFor,
}: {
  title: string;
  items: JellyfinItem[];
  onPlay?: (item: JellyfinItem) => void;
  href?: string;
  shape?: CatalogCardShape;
  upcoming?: boolean;
  subtitleFor?: (item: JellyfinItem) => string | undefined;
}) {
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    // Sub-pixel widths mean the end never lands exactly on scrollWidth.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    sync();
    const el = scrollerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [sync, items.length]);

  const nudge = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Leave a sliver of the outgoing card visible so the row reads as continuous.
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  if (items.length === 0) return null;
  const scrollable = !(atStart && atEnd);

  return (
    <section className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {href && (
          <Link
            href={href}
            aria-label={`See all ${title}`}
            className="flex size-5 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <ArrowRight className="size-3" />
          </Link>
        )}
        {scrollable && (
          // Pointer-only: touch scrolls the rail directly.
          <span className="ml-auto hidden items-center gap-1 [@media(hover:hover)]:flex">
            <RailArrow side="left" disabled={atStart} onClick={() => nudge(-1)} />
            <RailArrow side="right" disabled={atEnd} onClick={() => nudge(1)} />
          </span>
        )}
      </div>

      <div
        ref={scrollerRef}
        onScroll={sync}
        className="animate-rail-in flex gap-3 overflow-x-auto pb-2 scrollbar-hide -mx-4 px-4 md:-mx-6 md:px-6"
      >
        {items.map((item, index) => (
          <CatalogPosterCard
            key={item.Id}
            item={item}
            onPlay={onPlay}
            priority={index < 4}
            shape={shape}
            upcoming={upcoming}
            subtitle={subtitleFor?.(item)}
          />
        ))}
      </div>
    </section>
  );
}

function RailArrow({
  side,
  disabled,
  onClick,
}: {
  side: 'left' | 'right';
  disabled: boolean;
  onClick: () => void;
}) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'flex size-6 items-center justify-center rounded-full border border-border',
        'text-muted-foreground transition-colors',
        'hover:border-foreground hover:text-foreground',
        'disabled:opacity-30 disabled:hover:border-border disabled:hover:text-muted-foreground',
      )}
    >
      <Icon className="size-4" />
    </button>
  );
}
