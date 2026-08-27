'use client';

import Link from 'next/link';
import type { JellyfinItem } from '@/types/jellyfin';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';

export function CatalogRail({
  title,
  items,
  onPlay,
  href,
}: {
  title: string;
  items: JellyfinItem[];
  onPlay?: (item: JellyfinItem) => void;
  href?: string;
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
      <div className="flex gap-3 overflow-x-auto pb-2 [scrollbar-width:thin]">
        {items.map((item, index) => (
          <CatalogPosterCard key={item.Id} item={item} onPlay={onPlay} priority={index < 4} />
        ))}
      </div>
    </section>
  );
}
