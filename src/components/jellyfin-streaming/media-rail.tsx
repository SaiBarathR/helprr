'use client';

import Link from 'next/link';
import { WindowedRailItems } from '@/components/jellyfin-streaming/windowed-rail-items';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { cn } from '@/lib/utils';

/** Matches gap-2 on the cinematic track; used to page by whole tiles. */
const RAIL_GAP = 8;
/**
 * How long a horizontal wheel gesture is treated as one continuous motion.
 *
 * Trackpads emit a stream of small deltas, so the row has to follow the
 * pointer directly rather than animating to each one — the 500ms page
 * transition applied per event turns a flick into a crawl. The transition is
 * suspended while a gesture is in flight and restored once it settles.
 */
const WHEEL_IDLE_MS = 140;

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
  tileClassName,
}: {
  title: string;
  /** Secondary line beside the heading (recommendation rails explain themselves). */
  reason?: string | null;
  /** "See all" target, when the rail has a fuller page behind it. */
  href?: string;
  children: React.ReactNode;
  /** Number of tiles; the scroll state resyncs when it changes. */
  count: number;
  /** Known tile geometry enables mounting only the visible part of a rail. */
  tileClassName?: string;
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
  /**
   * Where each page starts, for the indicator the site shows at a row's
   * top-right — and now for jumping straight to one.
   *
   * An explicit list rather than a step and a count: the last page is short
   * (it stops at maxOffset rather than a whole step past it), so deriving the
   * current page by dividing by the step reported the same index for the last
   * two pages and the indicator never lit its final segment.
   */
  const [pages, setPages] = useState<number[]>([]);
  /** Suspends the page transition while a wheel gesture is in flight. */
  const [gesturing, setGesturing] = useState(false);

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

  /**
   * Stamp how each tile may behave, from the row's live geometry.
   *
   * Two things depend on where a tile currently sits, and neither can be a CSS
   * selector because both change with the page rather than with DOM order:
   *
   * - `data-pop-align` — which way the hover popover grows. The site clamps it
   *   to the row's content edges: the leftmost visible card grows entirely
   *   rightward, the rightmost entirely leftward, everything between grows both
   *   ways from its centre.
   * - `data-pop-clip` — a tile only part-way into view does not expand at all.
   *   That is what keeps the site's edge arrows reachable: without it the
   *   clipped tile at the row's edge expands under the arrow gutter (clamped to
   *   its own right edge, which is already past the content edge) at a higher
   *   z-index than the arrow, so the arrow you were reaching for disappeared
   *   under the card. It also stops a card you can barely see from starting a
   *   preview transcode.
   */
  const stampTiles = useCallback(() => {
    const viewport = scrollerRef.current;
    const track = trackRef.current;
    if (!viewport || !track || !window.matchMedia('(hover: hover)').matches) return;
    const v = viewport.getBoundingClientRect();
    const style = getComputedStyle(viewport);
    const padLeft = parseFloat(style.paddingLeft) || 0;
    const padRight = parseFloat(style.paddingRight) || 0;
    const left = v.left + padLeft;
    const right = v.right - padRight;

    // Complete every layout read before changing any selector attributes.
    const tiles = Array.from(track.querySelectorAll<HTMLElement>('.hpr-cine-tile'))
      .map((tile) => ({ tile, rect: tile.getBoundingClientRect() }));
    for (const { tile, rect: t } of tiles) {
      if (t.width === 0) continue;
      // 1px of slack: sub-pixel tile widths mean a fully-visible tile's edge
      // lands a fraction outside the content box.
      const clipped = t.left < left - 1 || t.right > right + 1;
      const clip = clipped ? '1' : '0';
      if (tile.dataset.popClip !== clip) tile.dataset.popClip = clip;
      const grow = t.width * 0.25;
      const align = t.left - grow < left - 1 ? 'start'
        : t.right + grow > right + 1 ? 'end'
          : 'center';
      if (tile.dataset.popAlign !== align) tile.dataset.popAlign = align;
    }
  }, []);

  useEffect(() => {
    if (!cinematic) return undefined;
    const track = trackRef.current;
    const viewport = scrollerRef.current;
    if (!track || !viewport) return undefined;
    const measure = () => {
      // The track is the scroller's content box, so its own overflow is
      // exactly how far the row can travel.
      const max = Math.max(0, track.scrollWidth - track.clientWidth);
      const first = track.firstElementChild as HTMLElement | null;
      const pitch = first ? first.offsetWidth + RAIL_GAP : track.clientWidth;
      // Page by a whole number of tiles, as the site does. Landing mid-tile
      // would leave a half-shown card that is still a hover target.
      const step = pitch > 0 ? Math.max(pitch, Math.floor(track.clientWidth / pitch) * pitch) : 0;
      const stops: number[] = [];
      if (step > 0 && max > 0) {
        for (let at = 0; at < max; at += step) stops.push(at);
      }
      stops.push(max);
      stampTiles();
      setMaxOffset(max);
      setOffset((current) => Math.min(current, max));
      setPages((current) => current.length === stops.length
        && current.every((stop, index) => stop === stops[index]) ? current : stops);
    };
    // One observer owns the track and its viewport. Coalesce notifications
    // into one read/write pass, including the initial mount.
    let frame = 0;
    const schedule = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(measure);
    };
    const onEnd = (event: TransitionEvent) => {
      if (event.target === track) schedule();
    };
    const pointer = window.matchMedia('(hover: hover)');
    const observer = new ResizeObserver(schedule);
    const observe = () => {
      observer.disconnect();
      if (pointer.matches) {
        observer.observe(track);
        observer.observe(viewport);
        schedule();
      } else {
        cancelAnimationFrame(frame);
        setOffset(0);
        setMaxOffset(0);
        setPages([]);
      }
    };
    observe();
    pointer.addEventListener('change', observe);
    track.addEventListener('transitionend', onEnd);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
      pointer.removeEventListener('change', observe);
      track.removeEventListener('transitionend', onEnd);
    };
  }, [cinematic, count, stampTiles]);

  // Pointer/focus entry stamps synchronously; paging is measured once per frame.
  useEffect(() => {
    if (!cinematic) return undefined;
    const frame = requestAnimationFrame(stampTiles);
    return () => cancelAnimationFrame(frame);
  }, [cinematic, stampTiles, offset]);

  const goTo = useCallback((next: number) => {
    setOffset(Math.min(maxOffset, Math.max(0, next)));
  }, [maxOffset]);

  /**
   * Horizontal wheel and trackpad scrolling.
   *
   * A clipped box has no scroll offset for the browser to move, so the row was
   * only reachable through its arrows — on a laptop trackpad, where a two-finger
   * swipe is the obvious gesture, the row simply did not respond (and the
   * browser was free to read the swipe as a back navigation instead).
   *
   * A native non-passive listener rather than onWheel: React registers wheel
   * handlers passively on its root container, so preventDefault() from a JSX
   * handler is ignored and the page keeps the gesture.
   */
  const gestureTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    if (!cinematic) return undefined;
    const viewport = scrollerRef.current;
    if (!viewport || maxOffset <= 1) return undefined;

    const onWheel = (event: WheelEvent) => {
      // Vertical intent belongs to the page. Netflix rows behave the same way:
      // only a clearly sideways gesture moves them.
      if (Math.abs(event.deltaX) <= Math.abs(event.deltaY)) return;
      event.preventDefault();
      setGesturing(true);
      setOffset((current) => Math.min(maxOffset, Math.max(0, current + event.deltaX)));
      window.clearTimeout(gestureTimer.current);
      gestureTimer.current = window.setTimeout(() => setGesturing(false), WHEEL_IDLE_MS);
    };

    viewport.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      viewport.removeEventListener('wheel', onWheel);
      window.clearTimeout(gestureTimer.current);
    };
  }, [cinematic, maxOffset]);

  const nudge = (direction: -1 | 1) => {
    if (cinematic) {
      const track = trackRef.current;
      if (!track) return;
      const step = (pages.length > 1 ? pages[1] : 0) || track.clientWidth;
      goTo(offset + direction * step);
      return;
    }
    const el = scrollerRef.current;
    if (!el) return;
    // Leave a sliver of the outgoing card visible so the row reads as continuous.
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  const scrollable = cinematic ? maxOffset > 1 : !(atStart && atEnd);
  const atRailStart = cinematic ? offset <= 0 : atStart;
  const atRailEnd = cinematic ? offset >= maxOffset - 1 : atEnd;
  // Nearest page stop, so the final (short) page lights its own segment.
  const currentPage = pages.reduce(
    (best, stop, stopIndex) => (Math.abs(stop - offset) < Math.abs(pages[best] - offset) ? stopIndex : best),
    0,
  );

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
            appears on row hover, like the arrows.
            The segments are real buttons — a marker you can see the row's shape
            in but not click is a dead control, and jumping straight to a page
            is the whole point of knowing how many there are. Each is padded out
            to a 16px-tall hit area around its 2px rule. */}
        {cinematic && pages.length > 1 && (
          <span className="ml-auto hidden items-center self-center opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 [@media(hover:hover)]:flex">
            {pages.map((stop, stopIndex) => (
              <button
                key={stop}
                type="button"
                aria-label={`Page ${stopIndex + 1} of ${pages.length} in ${title}`}
                aria-current={stopIndex === currentPage ? 'true' : undefined}
                onClick={() => goTo(stop)}
                className="group/dot flex h-4 items-center px-[1.5px]"
              >
                <span
                  className={cn(
                    'h-[2px] w-3 transition-colors',
                    stopIndex === currentPage ? 'bg-white' : 'bg-white/30 group-hover/dot:bg-white/70',
                  )}
                />
              </button>
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
            onPointerOver={stampTiles}
            onFocusCapture={stampTiles}
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
              className={cn(
                'flex w-full gap-2',
                // A wheel gesture drives the row directly; animating to each of
                // a trackpad's dozens of deltas turns a flick into a crawl.
                !gesturing && 'transition-transform duration-500 ease-out motion-reduce:transition-none',
              )}
              style={offset ? { transform: `translateX(-${offset}px)` } : undefined}
            >
              {tileClassName ? (
                <WindowedRailItems className={tileClassName} viewportRef={scrollerRef}>
                  {children}
                </WindowedRailItems>
              ) : children}
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
        // z-[45]: above an expanded card (z-40) and below the masthead (z-50).
        // Edge tiles no longer expand at all, so a popover should never reach
        // the gutter — but the arrow is the escape hatch for the whole row and
        // must not be coverable by the card next to it under any measurement
        // slack.
        'absolute inset-y-0 z-[45] hidden w-[var(--main-pad-x)] min-w-9 items-center justify-center',
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
