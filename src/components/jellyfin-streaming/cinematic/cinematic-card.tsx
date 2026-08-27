'use client';

import Link from 'next/link';
import { Check, Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { catalogHref, type CatalogCardProps } from '@/components/jellyfin-streaming/card-shared';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { useWatchModal } from '@/components/jellyfin-streaming/cinematic/watch-modal';
import {
  cardAspectClass,
  jellyfinCardImage,
  jellyfinSeriesCardImage,
  type CatalogCardShape,
} from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

/**
 * Tiles are materially bigger than the classic skin's. With the caption gone
 * the artwork is the only thing carrying the title, so it has to be large
 * enough to actually read — every streaming service lands around six tiles
 * across a desktop viewport, not the nine or ten a management UI fits.
 */
const WIDTH_CLASS: Record<CatalogCardShape, string> = {
  portrait: 'w-[112px] sm:w-[132px] md:w-[148px] lg:w-[160px] xl:w-[176px] 2xl:w-[196px]',
  square: 'w-[112px] sm:w-[132px] md:w-[148px] lg:w-[160px] xl:w-[176px] 2xl:w-[196px]',
  landscape: 'w-[168px] sm:w-[196px] md:w-[220px] lg:w-[240px] xl:w-[262px] 2xl:w-[292px]',
};

const SIZES: Record<CatalogCardShape, string> = {
  portrait: '220px',
  square: '220px',
  landscape: '344px',
};

function metaLine(item: JellyfinItem, asSeries: boolean): string | undefined {
  if (asSeries) {
    return `S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0} · ${item.Name}`;
  }
  if (item.Type === 'Episode') {
    return `S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0} · ${item.SeriesName ?? ''}`.trim();
  }
  if (item.Type === 'MusicAlbum' || item.Type === 'Audio') {
    return item.AlbumArtist || item.Artists?.join(', ') || undefined;
  }
  return [item.ProductionYear, item.Genres?.[0]].filter(Boolean).join(' · ') || undefined;
}

/**
 * The streaming-service tile: artwork only, no caption beneath it.
 *
 * Dropping the caption is the single biggest thing separating a streaming
 * home from a media manager — the art is the label. That only holds while the
 * art actually carries a title treatment, which Jellyfin's Thumb/Backdrop art
 * usually does but not always, so the title is still reachable: on pointer
 * devices it fades in over the art on hover (with the expand), and on touch,
 * where there is no hover, it rides a permanent bottom scrim.
 */
export function CinematicCard({
  item,
  onPlay,
  priority = false,
  className,
  shape: requestedShape = 'landscape',
  upcoming = false,
  subtitle,
  identity = 'item',
}: CatalogCardProps) {
  const modal = useWatchModal();
  const compact = useCompactViewport();
  // The Netflix app puts portrait posters in its phone rails; 16:9 stills only
  // appear from tablet up. The frame decides which artwork is fetched, so this
  // cannot be a media query.
  const shape = compact && requestedShape === 'landscape' ? 'portrait' : requestedShape;
  const asSeries = identity === 'series' && item.Type === 'Episode' && Boolean(item.SeriesName);
  // The series-level art is a 16:9 thumb, so it only belongs in a 16:9 frame;
  // dropping it into a portrait tile crops most of the picture away. For
  // portrait, jellyfinCardImage already borrows the series *poster*.
  const image = (asSeries && shape === 'landscape' ? jellyfinSeriesCardImage(item, 600) : null)
    ?? jellyfinCardImage(item, 600, shape);
  const progress = item.UserData?.PlayedPercentage;
  const unplayed = item.UserData?.UnplayedItemCount;
  const title = asSeries ? item.SeriesName! : item.Name;
  const href = catalogHref(item);
  const line2 = subtitle ?? metaLine(item, asSeries);
  const playable = Boolean(onPlay) && !upcoming;

  return (
    <div className={cn('hpr-cine-tile group relative shrink-0', WIDTH_CLASS[shape], className)}>
      <div className={cn('relative overflow-hidden rounded-xl bg-white/5', cardAspectClass(shape))}>
        {image ? (
          <FadeInImage
            src={image}
            alt={title}
            fill
            sizes={SIZES[shape]}
            priority={priority}
            unoptimized
            className="object-cover"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-white/60">
            {item.Name}
          </div>
        )}

        {/* Touch has no hover, so a 16:9 still needs its title written on it.
            A portrait poster does not: the title is part of the artwork, which
            is exactly why the Netflix app runs bare posters on phones. */}
        {shape === 'landscape' && (
          <>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/5 bg-gradient-to-t from-black/85 to-transparent [@media(hover:hover)]:hidden" />
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 text-[11px] font-medium text-white [@media(hover:hover)]:hidden">
              <span className="line-clamp-2">{title}</span>
            </span>
          </>
        )}

        {upcoming && (
          <span className="absolute top-2 left-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur-md">
            Upcoming
          </span>
        )}
        {item.UserData?.Played && (
          <span
            className="absolute top-2 right-2 z-20 flex size-5 items-center justify-center rounded-full bg-black/60 text-[var(--hpr-green)] backdrop-blur-md"
            title="Watched"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
        {typeof unplayed === 'number' && unplayed > 0 && (
          <span className="absolute top-2 right-2 z-20 min-w-5 rounded bg-black/60 px-1.5 text-center text-[11px] font-semibold text-white backdrop-blur-md">
            {unplayed}
          </span>
        )}

        {/* Pointer-only reveal. Opacity (and its intent delay) is driven by the
            .hpr-cine-reveal rule in globals.css so it stays in lockstep with
            the tile's expand instead of racing it. */}
        <span className="hpr-cine-reveal pointer-events-none absolute inset-0 z-20 hidden flex-col justify-end bg-gradient-to-t from-black/90 via-black/35 to-transparent p-2.5 opacity-0 transition-opacity duration-300 [@media(hover:hover)]:flex">
          <span className="flex items-end gap-2">
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[13px] font-semibold text-white">{title}</span>
              {line2 && <span className="block truncate text-[11px] text-white/70">{line2}</span>}
            </span>
            {playable && (
              <button
                type="button"
                aria-label={`Play ${title}`}
                onClick={() => onPlay?.(item)}
                className="pointer-events-auto flex size-9 shrink-0 items-center justify-center rounded-full bg-white text-black shadow-lg transition-transform hover:scale-105"
              >
                <Play className="size-4 fill-current" />
              </button>
            )}
          </span>
        </span>

        {typeof progress === 'number' && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] bg-white/25">
            <div className="h-full bg-[var(--hpr-amber)]" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        )}

        {/* Touch devices get a play affordance on 16:9 tiles, which have room
            for it. Portrait posters do not carry one in the Netflix app —
            tapping the poster opens the title, and that is the whole gesture. */}
        {playable && shape === 'landscape' && (
          <button
            type="button"
            aria-label={`Play ${title}`}
            onClick={() => onPlay?.(item)}
            className="absolute right-2 bottom-2 z-30 flex size-9 items-center justify-center rounded-full bg-white/90 text-black shadow-lg [@media(hover:hover)]:hidden"
          >
            <Play className="size-4 fill-current" />
          </button>
        )}
      </div>

      {/* Stretched link: one tab stop for the whole tile, and focus-within on
          the tile is what opens the reveal for keyboard users. */}
      <Link
        href={href}
        aria-label={title}
        onClick={(event) => {
          // A live channel has no detail page, and a modified click must stay
          // a real navigation so "open in new tab" keeps working.
          if (item.Type === 'TvChannel') return;
          if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
          // open() declines on phones, where a full page beats a cramped
          // overlay; the anchor then navigates as normal.
          if (modal?.open(item.Id)) event.preventDefault();
        }}
        className="absolute inset-0 z-10 rounded-xl focus-visible:ring-2 focus-visible:ring-white focus-visible:outline-none"
      />
    </div>
  );
}
