'use client';

import { Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { TwitchVideo } from './types';

const LIST_ROW_HEIGHT = 93;
const GRID_GAP = 12;
const GRID_TEXT_HEIGHT = 66;

function columnsFor(width: number): number {
  if (width >= 1280) return 6;
  if (width >= 1000) return 5;
  if (width >= 740) return 4;
  return width >= 520 ? 3 : 2;
}

/** Only the rows near the viewport are rendered, so a long feed costs a phone nothing. */
export function TwitchVideoList({ videos, layout, renderVideo }: {
  videos: TwitchVideo[];
  layout: 'grid' | 'list';
  renderVideo: (video: TwitchVideo) => React.ReactNode;
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
  const columns = isList ? 1 : columnsFor(width);
  const rows = useMemo(() => {
    const chunks: TwitchVideo[][] = [];
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
          className={cn('absolute inset-x-0 top-0', isList ? 'border-b border-border/50 last:border-b-0' : 'pb-4')}
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          {isList ? (
            // Rows are keyed by position, so an open menu must not follow it to another video.
            <Fragment key={rows[item.index][0].id}>{renderVideo(rows[item.index][0])}</Fragment>
          ) : (
            <div className="grid gap-x-3" style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}>
              {rows[item.index].map((video) => <div key={video.id} className="min-w-0">{renderVideo(video)}</div>)}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function TwitchVideoSkeleton() {
  return (
    <div role="status" aria-live="polite" aria-label="Loading videos">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" aria-hidden="true">
        {Array.from({ length: 12 }, (_, index) => (
          <div key={index} className="space-y-1.5">
            <Skeleton className="aspect-video w-full rounded-xl" />
            <Skeleton className="h-3 w-3/4" />
            <Skeleton className="h-2.5 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
