'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ArrowRight, ChevronLeft, ChevronRight } from 'lucide-react';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { cn } from '@/lib/utils';

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
  }, [sync, count]);

  const nudge = (direction: -1 | 1) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Leave a sliver of the outgoing card visible so the row reads as continuous.
    el.scrollBy({ left: direction * el.clientWidth * 0.9, behavior: 'smooth' });
  };

  const scrollable = !(atStart && atEnd);

  return (
    <section className={cn('group/row relative', cinematic ? undefined : 'space-y-2')}>
      {/* relative + z-10: the scroller below carries a negative margin for the
          hover expand's headroom, and without a stacking bump it covered this
          row — the "Explore all" link was unclickable because the tiles were
          hit-testing on top of it. */}
      <div className={cn('flex items-baseline gap-2', cinematic && 'relative z-10 mb-1')}>
        {cinematic && href ? (
          <Link href={href} className="inline-flex items-baseline gap-1.5">
            <h2 className="text-lg font-medium tracking-tight md:text-2xl">{title}</h2>
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
              cinematic ? 'text-lg font-medium md:text-2xl' : 'text-base font-semibold',
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

        {!cinematic && scrollable && (
          // Pointer-only: touch scrolls the rail directly.
          <span className="ml-auto hidden items-center gap-1 self-center [@media(hover:hover)]:flex">
            <RailArrow side="left" disabled={atStart} onClick={() => nudge(-1)} />
            <RailArrow side="right" disabled={atEnd} onClick={() => nudge(1)} />
          </span>
        )}
      </div>

      <div className="relative">
        <div
          ref={scrollerRef}
          onScroll={sync}
          className={cn(
            'flex overflow-x-auto scrollbar-hide',
            // Bleed by exactly the shell padding so tiles reach the viewport
            // edge without the page adding a second inset on top of it.
            '-mx-[var(--main-pad-x)] px-[var(--main-pad-x)]',
            cinematic
              // A scroll container clips both axes, so the hover expand takes
              // its headroom from the scroller's own padding; -my cancels the
              // gap that padding would otherwise add between rows.
              // A 1.5x expand on a ~148px-tall card needs ~37px of clearance
              // on each side; the scroller's own padding is the only place it
              // can come from, and -my pulls the rows back together.
              // Headroom for the 1.5x expand comes from the scroller's own
              // padding; only the bottom is pulled back, so the heading above
              // stays clickable.
              ? 'hpr-cine-row gap-2 py-10 -mt-4 -mb-6'
              : 'animate-rail-in gap-3 pb-2',
          )}
        >
          {children}
        </div>

        {cinematic && scrollable && (
          // Full-height edge slabs rather than small buttons beside the title:
          // the target is the whole side of the row, which is what makes
          // page-jumping feel effortless.
          <>
            <RailEdge side="left" hidden={atStart} onClick={() => nudge(-1)} />
            <RailEdge side="right" hidden={atEnd} onClick={() => nudge(1)} />
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
        'absolute inset-y-10 z-30 hidden w-[var(--main-pad-x)] min-w-9 items-center justify-center',
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
