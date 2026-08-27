'use client';

import Link from 'next/link';
import { Check, Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { catalogHref, type CatalogCardProps } from '@/components/jellyfin-streaming/card-shared';
import { CinematicCard } from '@/components/jellyfin-streaming/cinematic/cinematic-card';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import {
  cardAspectClass,
  jellyfinCardImage,
  jellyfinSeriesCardImage,
  type CatalogCardShape,
} from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

// Re-exported from its new shared home so existing importers keep working.
export { catalogHref };

/** Widths track DiscoverMediaRail's breakpoint scale so rails feel like one app. */
const WIDTH_CLASS: Record<CatalogCardShape, string> = {
  portrait: 'w-[110px] sm:w-[140px] md:w-[150px] lg:w-[164px] xl:w-[180px] 2xl:w-[196px]',
  square: 'w-[110px] sm:w-[140px] md:w-[150px] lg:w-[164px] xl:w-[180px] 2xl:w-[196px]',
  landscape: 'w-[184px] sm:w-[224px] md:w-[240px] lg:w-[264px] xl:w-[288px] 2xl:w-[312px]',
};

const SIZES: Record<CatalogCardShape, string> = {
  portrait: '196px',
  square: '196px',
  landscape: '312px',
};

function cardSubtitle(item: JellyfinItem): string | undefined {
  if (item.Type === 'Episode') {
    const code = `S${item.ParentIndexNumber ?? 0}E${item.IndexNumber ?? 0}`;
    return item.Name && item.SeriesName ? `${code} · ${item.SeriesName}` : code;
  }
  if (item.Type === 'MusicAlbum' || item.Type === 'Audio') {
    return item.AlbumArtist || item.Artists?.join(', ') || undefined;
  }
  if (item.ProductionYear) return String(item.ProductionYear);
  return item.AlbumArtist || item.Type;
}

/**
 * Skin switch. Every caller keeps importing CatalogPosterCard, so the eight
 * Watch pages and the rails need no knowledge of which skin is active.
 */
export function CatalogPosterCard(props: CatalogCardProps) {
  const skin = useWatchSkin();
  if (skin === 'cinematic') return <CinematicCard {...props} />;
  return <ClassicPosterCard {...props} />;
}

function ClassicPosterCard({
  item,
  onPlay,
  priority = false,
  className,
  shape = 'portrait',
  upcoming = false,
  subtitle,
  identity = 'item',
}: CatalogCardProps) {
  const asSeries = identity === 'series' && item.Type === 'Episode' && Boolean(item.SeriesName);
  const image = (asSeries ? jellyfinSeriesCardImage(item, 400) : null)
    ?? jellyfinCardImage(item, 400, shape);
  const progress = item.UserData?.PlayedPercentage;
  const unplayed = item.UserData?.UnplayedItemCount;
  const href = catalogHref(item);
  const title = asSeries ? item.SeriesName! : item.Name;
  const line2 = subtitle
    ?? (asSeries
      ? `S${item.ParentIndexNumber ?? 0}:E${item.IndexNumber ?? 0} · ${item.Name}`
      : cardSubtitle(item));
  const playable = Boolean(onPlay) && !upcoming;

  return (
    <div className={cn('group relative shrink-0', WIDTH_CLASS[shape], className)}>
      <div
        className={cn(
          'relative overflow-hidden rounded-xl border border-border/40 bg-muted/60',
          cardAspectClass(shape),
        )}
      >
        {image ? (
          <FadeInImage
            src={image}
            alt={title}
            fill
            sizes={SIZES[shape]}
            priority={priority}
            unoptimized
            className="object-cover transition-transform duration-300 group-hover:scale-[1.04]"
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {item.Name}
          </div>
        )}

        {/* Scrim and badges sit above the stretched link but take no clicks of
            their own, so the card keeps navigating. */}
        <span className="pointer-events-none absolute inset-0 z-20 bg-black/0 transition-colors group-hover:bg-black/35" />

        {upcoming && (
          <span className="absolute top-2 left-2 z-20 rounded-md border border-white/15 bg-black/45 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-[var(--hpr-green)] uppercase backdrop-blur-md">
            Upcoming
          </span>
        )}
        {typeof progress === 'number' && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 z-20 h-1.5 bg-black/45 backdrop-blur-sm">
            <div className="h-full bg-[var(--hpr-amber)]" style={{ width: `${Math.min(progress, 100)}%` }} />
          </div>
        )}
        {item.UserData?.Played && (
          <span
            className="absolute top-2 right-2 z-20 flex size-5 items-center justify-center rounded-full border border-white/15 bg-black/45 text-[var(--hpr-green)] backdrop-blur-md"
            title="Watched"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}
        {typeof unplayed === 'number' && unplayed > 0 && (
          <span className="absolute top-2 right-2 z-20 min-w-5 rounded-full border border-white/15 bg-black/45 px-1.5 text-center text-[11px] font-semibold text-[var(--hpr-blue)] backdrop-blur-md">
            {unplayed}
          </span>
        )}

        {playable && (
          <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <button
              type="button"
              aria-label={`Play ${title}`}
              onClick={() => onPlay?.(item)}
              className="pointer-events-auto flex size-11 items-center justify-center rounded-full bg-[var(--hpr-amber)] text-[var(--hpr-ink)] opacity-0 shadow-lg transition-opacity group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-85"
            >
              <Play className="size-5 fill-current" />
            </button>
          </span>
        )}
      </div>

      <p className="mt-2 truncate text-sm font-medium">{title}</p>
      {line2 && <p className="truncate text-[11px] text-muted-foreground">{line2}</p>}

      {/* Stretched link: one tab stop for the whole card, and no interactive
          element nested inside an anchor. */}
      <Link
        href={href}
        aria-label={title}
        className="absolute inset-0 z-10 rounded-xl focus-visible:ring-2 focus-visible:ring-[var(--hpr-amber)] focus-visible:outline-none"
      />
    </div>
  );
}
