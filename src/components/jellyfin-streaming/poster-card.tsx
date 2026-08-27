'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinCardImage, type CatalogCardShape } from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

/**
 * Where the card body navigates.
 *
 * Everything with a detail page goes there; the play button on the card starts
 * playback in place. A live channel is the one exception — it has no detail
 * page, so it is only ever played.
 */
export function catalogHref(item: JellyfinItem): string {
  if (item.Type === 'TvChannel') return `/jellyfin/library/watch/${item.Id}`;
  return `/jellyfin/library/item/${item.Id}`;
}

export function CatalogPosterCard({
  item,
  onPlay,
  priority = false,
  className,
  shape = 'poster',
}: {
  item: JellyfinItem;
  onPlay?: (item: JellyfinItem) => void;
  priority?: boolean;
  className?: string;
  /** Rails that must stay one uniform height pass 'thumb'. */
  shape?: CatalogCardShape;
}) {
  const image = jellyfinCardImage(item, 400, shape);
  const progress = item.UserData?.PlayedPercentage;
  const unplayed = item.UserData?.UnplayedItemCount;
  const href = catalogHref(item);
  const subtitle = item.Type === 'Episode'
    ? `S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0}${item.SeriesName ? ` · ${item.SeriesName}` : ''}`
    : item.ProductionYear
      ? String(item.ProductionYear)
      : item.AlbumArtist || item.Type;

  return (
    <div
      className={cn(
        'group relative shrink-0',
        shape === 'thumb' ? 'w-56 sm:w-64' : 'w-[8.5rem] sm:w-40',
        className,
      )}
    >
      <div
        className={cn(
          'relative overflow-hidden rounded-lg bg-muted',
          shape === 'thumb' ? 'aspect-video' : 'aspect-2/3',
        )}
      >
        {image ? (
          <FadeInImage
            src={image}
            alt={item.Name}
            fill
            sizes={shape === 'thumb' ? '256px' : '160px'}
            priority={priority}
            unoptimized
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.Name}
          </div>
        )}

        {/* Scrim and play affordance sit above the stretched link but take no
            clicks of their own, so the poster keeps navigating. */}
        <span className="pointer-events-none absolute inset-0 z-20 bg-black/0 transition-colors group-hover:bg-black/35" />

        {typeof progress === 'number' && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 z-20 h-1.5 bg-black/50">
            <div className="h-full bg-[var(--hpr-amber)]" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        )}
        {item.UserData?.Played && (
          <span className="absolute top-1.5 right-1.5 z-20 size-2 rounded-full bg-emerald-400 shadow" title="Watched" />
        )}
        {typeof unplayed === 'number' && unplayed > 0 && (
          <span className="absolute top-1.5 left-1.5 z-20 rounded-full bg-black/70 px-1.5 text-[10px] font-medium text-white">
            {unplayed}
          </span>
        )}

        {onPlay && (
          <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <button
              type="button"
              aria-label={`Play ${item.Name}`}
              onClick={() => onPlay(item)}
              className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-[var(--hpr-amber)] text-[var(--hpr-ink)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-85"
            >
              <Play className="size-5 fill-current" />
            </button>
          </span>
        )}
      </div>

      <p className="mt-1.5 truncate text-sm font-medium">{item.Name}</p>
      {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}

      {/* Stretched link: one tab stop for the whole card, and no interactive
          element nested inside an anchor. */}
      <Link
        href={href}
        aria-label={item.Name}
        className="absolute inset-0 z-10 rounded-lg focus-visible:ring-2 focus-visible:ring-[var(--hpr-amber)] focus-visible:outline-none"
      />
    </div>
  );
}
