'use no memo';
'use client';

import { useRef } from 'react';
import Link from 'next/link';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ArrowUpRight } from 'lucide-react';
import { PersonCard } from '@/components/media/person-card';
import type { ImageServiceHint } from '@/lib/image';

interface VirtualizedPersonRailItem {
  id: number;
  name: string;
  imagePath: string | null;
  subtitle?: string;
  keySuffix?: string;
}

interface VirtualizedPersonRailProps {
  title: string;
  items: VirtualizedPersonRailItem[];
  cacheService: ImageServiceHint;
  titleTextClassName?: string;
  headerClassName?: string;
  viewAllHref?: string;
  eyebrow?: string;
}

const CARD_HEIGHT = 56;

export function VirtualizedPersonRail({
  title,
  items,
  cacheService,
  titleTextClassName,
  headerClassName = 'mb-3',
  viewAllHref,
  eyebrow,
}: VirtualizedPersonRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 200,
    horizontal: true,
    overscan: 5,
    gap: 10,
  });

  if (!items.length) return null;

  const titleClass = titleTextClassName || 'font-display text-[18px] sm:text-[20px] leading-tight tracking-[-0.018em]';

  return (
    <div>
      <div className={`flex items-end justify-between gap-3 ${headerClassName}`}>
        <div className="min-w-0 flex items-end gap-2.5">
          <span className="reel mb-1.5" aria-hidden />
          <div className="min-w-0">
            {eyebrow && (
              <p className="tracked-caps text-[8.5px] text-muted-foreground/80 mb-0.5" style={{ letterSpacing: '0.22em' }}>
                {eyebrow}
              </p>
            )}
            <h2 className={titleClass}>{title}</h2>
          </div>
        </div>
        {viewAllHref && (
          <Link
            href={viewAllHref}
            className="press-feedback group/all shrink-0 inline-flex items-center gap-1 tracked-caps text-[10px] text-muted-foreground hover:text-[color:var(--amber)] transition-colors"
          >
            View All
            <ArrowUpRight className="h-3 w-3 transition-transform group-hover/all:translate-x-0.5 group-hover/all:-translate-y-0.5" />
          </Link>
        )}
      </div>
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide"
      >
        <div
          className="relative"
          style={{
            width: virtualizer.getTotalSize(),
            height: CARD_HEIGHT,
          }}
        >
          {virtualizer.getVirtualItems().map((virtualItem) => {
            const item = items[virtualItem.index];
            return (
              <div
                key={`${item.id}-${item.keySuffix || virtualItem.index}`}
                data-index={virtualItem.index}
                ref={virtualizer.measureElement}
                className="absolute top-0"
                style={{
                  left: virtualItem.start,
                }}
              >
                <PersonCard
                  name={item.name}
                  personId={item.id}
                  imagePath={item.imagePath}
                  subtitle={item.subtitle}
                  cacheService={cacheService}
                />
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
