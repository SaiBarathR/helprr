'use client';

import Link from 'next/link';
import type { JellyfinItem } from '@/types/jellyfin';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import type { CatalogCardShape } from '@/lib/jellyfin-playback/image';

export function CatalogRail({
  title,
  items,
  onPlay,
  href,
  shape,
}: {
  title: string;
  items: JellyfinItem[];
  onPlay?: (item: JellyfinItem) => void;
  href?: string;
  shape?: CatalogCardShape;
}) {
  if (items.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="flex items-baseline justify-between gap-3 px-1">
        <h2 className="text-base font-semibold tracking-tight">{title}</h2>
        {href && (
          <Link href={href} className="text-xs text-muted-foreground hover:text-foreground">See all</Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 scrollbar-hide">
        {items.map((item, index) => (
          <CatalogPosterCard key={item.Id} item={item} onPlay={onPlay} priority={index < 4} shape={shape} />
        ))}
      </div>
    </section>
  );
}
