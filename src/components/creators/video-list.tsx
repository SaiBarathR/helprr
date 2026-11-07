'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { CreatorVideoItem } from './types';

const LIST_ROW_HEIGHT = 93;
const GRID_GAP = 16;
const GRID_TEXT_HEIGHT = 92;
/** Narrowest a tile gets before the row drops a column: YouTube's own spacing. */
const MIN_TILE_WIDTH = { wide: 360, rail: 220 } as const;
/** A phone shows one video across, as the YouTube app does. */
const SINGLE_COLUMN_BELOW = 500;

/** `rail` tiles are the size of the feed's rails (feed-groups), about five across a laptop. */
export type TileSize = keyof typeof MIN_TILE_WIDTH;

export function columnsFor(width: number, tile: TileSize = 'wide'): number {
  if (width < SINGLE_COLUMN_BELOW) return 1;
  const fit = Math.floor((width + GRID_GAP) / (MIN_TILE_WIDTH[tile] + GRID_GAP));
  return Math.min(6, Math.max(2, fit));
}

/** Only the rows near the viewport are rendered, so a long feed costs a phone nothing. */
export function CreatorVideoList({ videos, layout, tile = 'wide', renderVideo }: {
  videos: CreatorVideoItem[];
  layout: 'grid' | 'list';
  tile?: TileSize;
  renderVideo: (video: CreatorVideoItem) => React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [scrollMargin, setScrollMargin] = useState(0);

  useLayoutEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const measure = () => {
      setWidth(element.clientWidth);
      setScrollMargin(element.getBoundingClientRect().top + window.scrollY);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    // Shelves that load above the list move it without resizing it.
    if (element.parentElement) observer.observe(element.parentElement);
    return () => observer.disconnect();
  }, []);

  const isList = layout === 'list';
  const columns = isList ? 1 : columnsFor(width, tile);
  const rows = useMemo(() => {
    const chunks: CreatorVideoItem[][] = [];
    for (let index = 0; index < videos.length; index += columns) chunks.push(videos.slice(index, index + columns));
    return chunks;
  }, [videos, columns]);

  const tileWidth = (width - GRID_GAP * (columns - 1)) / columns;
  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => (isList ? LIST_ROW_HEIGHT : (tileWidth * 9) / 16 + GRID_TEXT_HEIGHT),
    overscan: 3,
    scrollMargin,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, columns, isList]);

  return (
    <div
      ref={containerRef}
      className={cn('relative', isList && 'overflow-hidden rounded-xl bg-card')}
      style={{ height: virtualizer.getTotalSize() }}
    >
      {virtualizer.getVirtualItems().map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className={cn('absolute inset-x-0 top-0', isList ? 'border-b border-border/50 last:border-b-0' : 'pb-6')}
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          {isList ? (
            // Rows are keyed by position, so an open menu must not follow it to another video.
            <Fragment key={rows[item.index][0].id}>{renderVideo(rows[item.index][0])}</Fragment>
          ) : (
            <div className="grid gap-x-4" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {rows[item.index].map((video) => <div key={video.id} className="min-w-0">{renderVideo(video)}</div>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

// Container queries, matching columnsFor (n columns from n × tile + (n - 1) × gap),
// so the real list does not reflow the skeleton.
const SKELETON_COLUMNS: Record<TileSize, string> = {
  wide: '@[500px]:grid-cols-2 @[1112px]:grid-cols-3 @[1488px]:grid-cols-4',
  rail: '@[500px]:grid-cols-2 @[692px]:grid-cols-3 @[928px]:grid-cols-4 @[1164px]:grid-cols-5 @[1400px]:grid-cols-6',
};

export function CreatorVideoSkeleton({ tile = 'wide' }: { tile?: TileSize }) {
  return (
    <div role="status" aria-live="polite" aria-label="Loading videos" className="@container">
      <div className={cn('grid grid-cols-1 gap-x-4 gap-y-6', SKELETON_COLUMNS[tile])} aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="space-y-2.5">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <div className="flex gap-3">
              <Skeleton className="h-9 w-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-3.5 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
