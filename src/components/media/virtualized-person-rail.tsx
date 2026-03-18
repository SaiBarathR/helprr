'use no memo';
'use client';

import { useRef } from 'react';
import { useVirtualizer } from '@tanstack/react-virtual';
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
  titleClassName?: string;
}

// PersonCard height: p-2 (8px) + h-10 image (40px) + p-2 (8px) = 56px
const CARD_HEIGHT = 56;

export function VirtualizedPersonRail({
  title,
  items,
  cacheService,
  titleClassName = 'text-base font-semibold px-4 mb-2',
}: VirtualizedPersonRailProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 180,
    horizontal: true,
    overscan: 5,
    gap: 10,
  });

  if (!items.length) return null;

  return (
    <div>
      <h2 className={titleClassName}>{title}</h2>
      <div
        ref={scrollRef}
        className="overflow-x-auto pb-1 px-4 scrollbar-hide"
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
