'use client';

import { memo } from 'react';

import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { cinematicCardLayout } from '@/components/jellyfin-streaming/cinematic/card-layout';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { MediaRail } from '@/components/jellyfin-streaming/media-rail';
import type { CatalogRailProps } from '@/components/jellyfin-streaming/rail-shared';

/**
 * A rail of Jellyfin catalog items.
 *
 * Both the shell (MediaRail) and the tile (CatalogPosterCard) pick their own
 * skin, so there is nothing skin-specific left here.
 */
export const CatalogRail = memo(function CatalogRail({
  title,
  items,
  onPlay,
  href,
  shape = 'portrait',
  upcoming = false,
  subtitleFor,
  identity,
}: CatalogRailProps) {
  const skin = useWatchSkin();
  const compact = useCompactViewport();
  if (items.length === 0) return null;

  return (
    <MediaRail
      title={title}
      href={href}
      count={items.length}
      tileClassName={skin === 'cinematic' ? cinematicCardLayout(shape, compact) : undefined}
    >
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
});
