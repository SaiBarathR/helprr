'use client';

import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';
import type { CatalogRailProps } from '@/components/jellyfin-streaming/rail-shared';

/**
 * A rail of Jellyfin catalog items.
 *
 * Both the shell (MediaRail) and the tile (CatalogPosterCard) pick their own
 * skin, so there is nothing skin-specific left here.
 */
export function CatalogRail({
  title,
  items,
  onPlay,
  href,
  shape = 'portrait',
  upcoming = false,
  subtitleFor,
  identity,
}: CatalogRailProps) {
  if (items.length === 0) return null;

  return (
    <MediaRail title={title} href={href} count={items.length}>
      {items.map((item, index) => (
        <CatalogPosterCard
          key={item.Id}
          item={item}
          onPlay={onPlay}
          priority={index < 4}
          shape={shape}
          upcoming={upcoming}
          subtitle={subtitleFor?.(item)}
          identity={identity}
        />
      ))}
    </MediaRail>
  );
}
