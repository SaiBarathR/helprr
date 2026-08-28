'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { cn } from '@/lib/utils';

/** Matches gap-2 on the cinematic track; used to page by whole tiles. */
const RAIL_GAP = 8;

/**
 * The one horizontal rail shell in the Watch section.
 *
 * Every rail here — catalog, upcoming, recommendations, trailers — used to
 * bring its own heading, scroller and arrows, which is exactly how three of
 * them silently kept the classic look after the cinematic skin landed. Any new
 * rail composes this instead, so a skin change reaches all of them at once.
 */
export function MediaRail({
  title,
  reason,
  href,
  children,
  count,
}: {
  title: string;
  /** Secondary line beside the heading (recommendation rails explain themselves). */
  reason?: string | null;
  /** "See all" target, when the rail has a fuller page behind it. */
  href?: string;
  children: React.ReactNode;
  /** Number of tiles; the scroll state resyncs when it changes. */
  count: number;
}) {
  const skin = useWatchSkin();
  const cinematic = skin === 'cinematic';
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const [atStart, setAtStart] = useState(true);
  const [atEnd, setAtEnd] = useState(true);
  /**
   * Cinematic rails page by transform instead of scrolling.
   *
   * On pointer devices the row is `overflow-x: clip` so the hover popover can
   * escape it vertically — a clipped box has no scroll position to move, so
   * the arrows translate the track instead. Touch keeps native scrolling: the
   * arrows are pointer-only, so the offset simply stays at 0 there.
   */
  const [offset, setOffset] = useState(0);
  const [maxOffset, setMaxOffset] = useState(0);
  /** Page width and count, for the indicator the site shows at a row's top-right. */
  const [paging, setPaging] = useState({ step: 0, count: 0 });

  const sync = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    setAtStart(el.scrollLeft <= 1);
    // Sub-pixel widths mean the end never lands exactly on scrollWidth.
    setAtEnd(el.scrollLeft + el.clientWidth >= el.scrollWidth - 1);
  }, []);

  useEffect(() => {
    if (cinematic) return undefined;
    sync();
    const el = scrollerRef.current;
    if (!el) return undefined;
    const observer = new ResizeObserver(sync);
    observer.observe(el);
    return () => observer.disconnect();
  }, [cinematic, sync, count]);

  useEffect(() => {
    if (!cinematic) return undefined;
    const track = trackRef.current;
    if (!track) return undefined;
    const measure = () => {
      // The track is the scroller's content box, so its own overflow is
      // exactly how far the row can travel.
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      setMaxOffset(max);
      setOffset((current) => Math.min(current, max));

      const first = track.firstElementChild as HTMLElement | null;
      const pitch = first ? first.offsetWidth + RAIL_GAP : track.clientWidth;
      const step = pitch > 0 ? Math.max(pitch, Math.floor(track.clientWidth / pitch) * pitch) : 0;
      setPaging({ step, count: step > 0 ? Math.ceil(track.scrollWidth / step) : 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [cinematic, count]);

  const nudge = (direction: -1 | 1) => {
    if (cinematic) {
      const track = trackRef.current;
      if (!track) return;
      // Page by a whole number of tiles, as the site does. Landing mid-tile
      // would leave a half-shown card that is still a hover target, and its
      // popover would then grow into the clipped edge.
      const step = paging.step || track.clientWidth;
      setOffset((current) => Math.min(maxOffset, Math.max(0, current + direction * step)));
      return;
    }
    const el = scrollerRef.current;
    if (!el) return;
    // Leave a sliver of the outgoing card visible so the row reads as continuous.
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  /**
   * Stamp which way the hover popover should grow.
   *
   * The site clamps it to the row's content edges: the leftmost visible card
   * grows entirely rightward, the rightmost entirely leftward, everything
   * between grows both ways from its centre. Which card is at an edge depends
   * on the current page, so CSS `:first-child` cannot say — and one delegated
   * listener here covers both tile components at once.
   */
  const alignPopover = useCallback((target: EventTarget | null) => {
    const tile = target instanceof Element ? target.closest<HTMLElement>('.hpr-cine-tile') : null;
    const viewport = scrollerRef.current;
    if (!tile || !viewport) return;
    const t = tile.getBoundingClientRect();
    const v = viewport.getBoundingClientRect();
    const pad = parseFloat(getComputedStyle(viewport).paddingLeft) || 0;
    const grow = t.width * 0.25;
    tile.dataset.popAlign = t.left - grow < v.left + pad - 1 ? 'start'
      : t.right + grow > v.right - pad + 1 ? 'end'
      : 'center';
  }, []);

  const scrollable = cinematic ? maxOffset > 1 : !(atStart && atEnd);
  const atRailStart = cinematic ? offset <= 0 : atStart;
  const atRailEnd = cinematic ? offset >= maxOffset - 1 : atEnd;
  const currentPage = paging.step > 0 ? Math.round(offset / paging.step) : 0;

  return (
    <section className={cn('group/row relative', cinematic ? undefined : 'space-y-2')}>
      {/* relative + z-10: the scroller below carries a negative margin for the
          hover expand's headroom, and without a stacking bump it covered this
          row — the "Explore all" link was unclickable because the tiles were
          hit-testing on top of it. */}
      {/* mb-3 puts 14px between the heading and the tiles once the row's own
          2px padding is added — the gap measured on the site. */}
      <div className={cn('flex items-baseline gap-2', cinematic && 'relative z-10 mb-3')}>
        {cinematic && href ? (
          <Link href={href} className="inline-flex items-baseline gap-1.5">
            <h2 className="text-lg font-bold tracking-tight md:text-2xl md:font-medium">{title}</h2>
            {/* "Explore all" only on row hover, as the streaming apps do — a
                shortcut, not a permanent piece of furniture. */}
            <span className="translate-x-[-4px] text-[11px] font-medium text-[var(--hpr-blue)] opacity-0 transition-all group-hover/row:translate-x-0 group-hover/row:opacity-100 group-focus-within/row:translate-x-0 group-focus-within/row:opacity-100">
              Explore all ›
            </span>
          </Link>
        ) : (
          <h2
            className={cn(
              'tracking-tight',
              cinematic ? 'text-lg font-bold md:text-2xl md:font-medium' : 'text-base font-semibold',
            )}
          >
            {title}
          </h2>
        )}

        {!cinematic && href && (
          <Link
            href={href}
            aria-label={`See all ${title}`}
            className="flex size-5 items-center justify-center self-center rounded-full border border-border text-muted-foreground transition-colors hover:border-foreground hover:text-foreground"
          >
            <ArrowRight className="size-3" />
          </Link>
        )}
        {reason && <p className="truncate text-[11px] text-muted-foreground">{reason}</p>}

        {/* The site's page indicator: a segmented track at the row's top-right
            showing how many pages the row has and which one you are on. It
            appears on row hover, like the arrows. */}
        {cinematic && paging.count > 1 && (
          <span
            aria-hidden
            className="ml-auto hidden items-center gap-[3px] self-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:flex"
          >
            {Array.from({ length: paging.count }, (_, index) => (
              <span
                key={index}
                className={cn('h-[2px] w-3', index === currentPage ? 'bg-white' : 'bg-white/30')}
              />
            ))}
          </span>
        )}

        {!cinematic && scrollable && (
          // Pointer-only: touch scrolls the rail directly.
          <span className="ml-auto hidden items-center gap-1 self-center [@media(hover:hover)]:flex">
            <RailArrow side="left" disabled={atStart} onClick={() => nudge(-1)} />
            <RailArrow side="right" disabled={atEnd} onClick={() => nudge(1)} />
          </span>
        )}
      </div>

      <div className="relative">
        {cinematic ? (
          <div
            ref={scrollerRef}
            onPointerOver={(event) => alignPopover(event.target)}
            onFocusCapture={(event) => alignPopover(event.target)}
            className={cn(
              'hpr-cine-row overflow-x-auto scrollbar-hide',
              // Bleed by exactly the shell padding so tiles reach the viewport
              // edge without the page adding a second inset on top of it.
              '-mx-[var(--main-pad-x)] px-[var(--main-pad-x)]',
              // The site's row box is the tile plus 2px. It needs no headroom
              // for the hover expand because the popover escapes the row
              // vertically instead of growing inside it.
              'py-0.5',
            )}
          >
            {/* Full-width block, so its own overflow measures the travel. */}
            <div
              ref={trackRef}
              className="flex w-full gap-2 transition-transform duration-500 ease-out motion-reduce:transition-none"
              style={offset ? { transform: `translateX(-${offset}px)` } : undefined}
            >
              {children}
            </div>
          </div>
        ) : (
          <div
            ref={scrollerRef}
            onScroll={sync}
            className={cn(
              'flex overflow-x-auto scrollbar-hide',
              '-mx-[var(--main-pad-x)] px-[var(--main-pad-x)]',
              'animate-rail-in gap-3 pb-2',
            )}
          >
            {children}
          </div>
        )}

        {cinematic && scrollable && (
          // Full-height edge slabs rather than small buttons beside the title:
          // the target is the whole side of the row, which is what makes
          // page-jumping feel effortless.
          <>
            <RailEdge side="left" hidden={atRailStart} onClick={() => nudge(-1)} />
            <RailEdge side="right" hidden={atRailEnd} onClick={() => nudge(1)} />
          </>
        )}
      </div>
    </section>
  );
}

function RailArrow({ side, disabled, onClick }: { side: 'left' | 'right'; disabled: boolean; onClick: () => void }) {
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

function RailEdge({ side, hidden, onClick }: { side: 'left' | 'right'; hidden: boolean; onClick: () => void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight;
  if (hidden) return null;
  return (
    <button
      type="button"
      aria-label={side === 'left' ? 'Scroll left' : 'Scroll right'}
      onClick={onClick}
      className={cn(
        'absolute inset-y-0 z-30 hidden w-[var(--main-pad-x)] min-w-9 items-center justify-center',
        'bg-black/50 text-white opacity-0 transition-opacity',
        'group-hover/row:opacity-100 focus-visible:opacity-100 focus-visible:outline-none',
        '[@media(hover:hover)]:flex',
        side === 'left' ? 'left-[calc(-1*var(--main-pad-x))]' : 'right-[calc(-1*var(--main-pad-x))]',
      )}
    >
      <Icon className="size-7" strokeWidth={2.5} />
    </button>
  );
}
