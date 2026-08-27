'use client';

import Link from 'next/link';
import { Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { jellyfinPosterUrl } from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

export function catalogHref(item: JellyfinItem): string {
  const playable = item.MediaType === 'Video' || item.MediaType === 'Audio' || item.Type === 'TvChannel';
  if (playable && item.Type !== 'Series' && item.Type !== 'Season' && item.Type !== 'BoxSet' && item.Type !== 'Folder') {
    return `/jellyfin/library/watch/${item.Id}`;
  }
  return `/jellyfin/library/item/${item.Id}`;
}

export function CatalogPosterCard({
  item,
  onPlay,
  priority = false,
  className,
}: {
  item: JellyfinItem;
  onPlay?: (item: JellyfinItem) => void;
  priority?: boolean;
  className?: string;
}) {
  const poster = jellyfinPosterUrl(item, 400);
  const progress = item.UserData?.PlayedPercentage;
  const unplayed = item.UserData?.UnplayedItemCount;
  const href = catalogHref(item);
  const subtitle = item.Type === 'Episode'
    ? `S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0}${item.SeriesName ? ` · ${item.SeriesName}` : ''}`
    : item.ProductionYear
      ? String(item.ProductionYear)
      : item.AlbumArtist || item.Type;

  return (
    <div className={cn('group relative w-[8.5rem] shrink-0 sm:w-40', className)}>
      <Link href={href} className="block">
        <div className="relative aspect-2/3 overflow-hidden rounded-lg bg-muted">
          {poster ? (
            <FadeInImage
              src={poster}
              alt=""
              fill
              sizes="160px"
              priority={priority}
              unoptimized
              className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
            />
          ) : (
            <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
              {item.Name}
            </div>
          )}
          {typeof progress === 'number' && progress > 0 && progress < 100 && (
            <div className="absolute inset-x-0 bottom-0 h-1 bg-black/50">
              <div className="h-full bg-[var(--hpr-amber)]" style={{ width: `${Math.min(progress, 100)}%` }} />
            </div>
          )}
          {item.UserData?.Played && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-emerald-400 shadow" title="Watched" />
          )}
          {typeof unplayed === 'number' && unplayed > 0 && (
            <span className="absolute top-1.5 left-1.5 rounded-full bg-black/70 px-1.5 text-[10px] font-medium text-white">
              {unplayed}
            </span>
          )}
          <button
            type="button"
            aria-label={`Play ${item.Name}`}
            onClick={(event) => {
              event.preventDefault();
              onPlay?.(item);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/0 opacity-0 transition group-hover:bg-black/35 group-hover:opacity-100 focus-visible:opacity-100"
          >
            <span className="flex size-12 items-center justify-center rounded-full bg-[var(--hpr-amber)] text-[var(--hpr-ink)] shadow-lg">
              <Play className="size-5 fill-current" />
            </span>
          </button>
        </div>
        <p className="mt-1.5 truncate text-sm font-medium">{item.Name}</p>
        {subtitle && <p className="truncate text-[11px] text-muted-foreground">{subtitle}</p>}
      </Link>
    </div>
  );
}
