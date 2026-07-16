'use client';

import { useCallback, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { RecommendationRail } from '@/lib/recommendations/rec-types';
import { RecCard } from './rec-card';
import type { RecEventTracker } from './use-rec-events';

interface RecRailProps {
  rail: RecommendationRail;
  tracker: RecEventTracker;
  hiddenKeys: Set<string>;
  onNotInterested: (itemKey: string) => void;
}

/** One horizontal Netflix-style row: title, optional reason, scrollable cards.
 * Touch scrolls with gentle snap; desktop pointers get Netflix-style paging
 * chevrons that advance one viewport at a time. */
export function RecRail({ rail, tracker, hiddenKeys, onNotInterested }: RecRailProps) {
  const scroller = useRef<HTMLDivElement | null>(null);
  const [scrollState, setScrollState] = useState<'start' | 'middle' | 'end'>('start');
  const items = rail.items.filter((item) => !hiddenKeys.has(item.itemKey));

  const updateScrollState = useCallback(() => {
    const node = scroller.current;
    if (!node) return;
    const atStart = node.scrollLeft <= 8;
    const atEnd = node.scrollLeft + node.clientWidth >= node.scrollWidth - 8;
    setScrollState(atStart ? 'start' : atEnd ? 'end' : 'middle');
  }, []);

  const page = useCallback((direction: 1 | -1) => {
    const node = scroller.current;
    if (!node) return;
    node.scrollBy({ left: direction * node.clientWidth * 0.9, behavior: 'smooth' });
  }, []);

  if (items.length === 0) return null;
  const canScroll = items.length > 4;

  return (
    <section className="group/rail relative space-y-2">
      <div className="px-2 md:px-6">
        <h2 className="text-base font-semibold leading-tight">{rail.title}</h2>
        {rail.reason && <p className="text-xs text-muted-foreground">{rail.reason}</p>}
      </div>
      <div className="relative">
        <div
          ref={scroller}
          onScroll={updateScrollState}
          className="flex snap-x snap-proximity gap-2.5 overflow-x-auto px-2 pb-2 scrollbar-hide md:gap-3 md:px-6"
        >
          {items.map((item, position) => (
            <div key={item.itemKey} className="snap-start scroll-ml-2 md:scroll-ml-6">
              <RecCard
                item={item}
                railId={rail.id}
                position={position}
                mode="rails"
                tracker={tracker}
                onNotInterested={onNotInterested}
              />
            </div>
          ))}
        </div>
        {/* Desktop paging chevrons — appear on rail hover, Netflix-style. */}
        {canScroll && scrollState !== 'start' && (
          <button
            type="button"
            aria-label={`Scroll ${rail.title} back`}
            onClick={() => page(-1)}
            className="absolute inset-y-0 left-0 z-10 hidden w-10 items-center justify-center bg-gradient-to-r from-background/90 to-transparent opacity-0 transition-opacity group-hover/rail:opacity-100 md:flex"
          >
            <ChevronLeft className="h-7 w-7" />
          </button>
        )}
        {canScroll && scrollState !== 'end' && (
          <button
            type="button"
            aria-label={`Scroll ${rail.title} forward`}
            onClick={() => page(1)}
            className="absolute inset-y-0 right-0 z-10 hidden w-10 items-center justify-center bg-gradient-to-l from-background/90 to-transparent opacity-0 transition-opacity group-hover/rail:opacity-100 md:flex"
          >
            <ChevronRight className="h-7 w-7" />
          </button>
        )}
      </div>
    </section>
  );
}
