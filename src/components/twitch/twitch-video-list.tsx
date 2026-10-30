'use client';

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { cn } from '@/lib/utils';
import type { TwitchVideo } from './types';

function columnsFor(width: number): number {
  if (width >= 1000) return 3;
  return width >= 600 ? 2 : 1;
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
    return () => observer.disconnect();
  }, []);

  const columns = layout === 'list' ? 1 : columnsFor(width);
  const rows = useMemo(() => {
    const chunks: TwitchVideo[][] = [];
    for (let index = 0; index < videos.length; index += columns) chunks.push(videos.slice(index, index + columns));
    return chunks;
  }, [videos, columns]);

  const virtualizer = useWindowVirtualizer({
    count: rows.length,
    estimateSize: () => (layout === 'list' ? 112 : 290),
    overscan: 3,
    scrollMargin,
  });
  useEffect(() => {
    virtualizer.measure();
  }, [virtualizer, columns, layout]);

  const items = virtualizer.getVirtualItems();
  return (
    <div ref={containerRef} className="relative" style={{ height: virtualizer.getTotalSize() }}>
      {items.map((item) => (
        <div
          key={item.key}
          data-index={item.index}
          ref={virtualizer.measureElement}
          className="absolute inset-x-0 top-0 pb-5"
          style={{ transform: `translateY(${item.start - scrollMargin}px)` }}
        >
          <div className={cn('grid gap-x-4', columns === 3 ? 'grid-cols-3' : columns === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
            {rows[item.index].map((video) => <div key={video.id} className="min-w-0">{renderVideo(video)}</div>)}
          </div>
        </div>
      ))}
    </div>
  );
}
