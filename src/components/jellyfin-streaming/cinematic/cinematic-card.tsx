'use client';

import { useId, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Play } from 'lucide-react';
import type { JellyfinItem } from '@/types/jellyfin';
import { FadeInImage } from '@/components/media/fade-in-image';
import { useCan } from '@/components/permission-provider';
import { catalogHref, type CatalogCardProps } from '@/components/jellyfin-streaming/card-shared';
import { TilePanel, type TilePanelContent } from '@/components/jellyfin-streaming/cinematic/tile-panel';
import { useFavoriteToggle } from '@/components/jellyfin-streaming/cinematic/use-favorite-toggle';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { useMediaPreview } from '@/components/jellyfin-streaming/cinematic/media-preview';
import { useHoverPreviewSlot } from '@/components/jellyfin-streaming/cinematic/hover-preview-slot';
import { useUIStore } from '@/lib/store';
import { useWatchModal } from '@/components/jellyfin-streaming/cinematic/watch-modal';
import {
  cardAspectClass,
  jellyfinCardImage,
  jellyfinSeriesCardImage,
  type CatalogCardShape,
} from '@/lib/jellyfin-playback/image';
import { formatCertificate, formatRuntimeShort, isRecentlyAdded } from '@/lib/jellyfin-playback/metadata';
import { ticksToSeconds } from '@/lib/jellyfin-playback/device';
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
  flat = false,
}: CatalogCardProps) {
  const modal = useWatchModal();
  const router = useRouter();
  const compact = useCompactViewport();
  const canFavorite = useCan('jellyfin.watchedState');
  const favorite = useFavoriteToggle(item.Id, item.UserData?.IsFavorite ?? false);
  const previewsAllowed = useUIStore((state) => state.watchPreviews);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [hovering, setHovering] = useState(false);
  const hoverTimer = useRef<number | undefined>(undefined);
  // Exactly one card may hold the preview slot, so brushing across a row can
  // never leave a trail of transcodes running on the server.
  const cardId = useId();
  const holdsSlot = useHoverPreviewSlot(cardId, hovering);
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
  const unplayed = item.UserData?.UnplayedItemCount ?? 0;
  // A series with unwatched leaves is the site's "New Episode" case.
  const hasNewEpisodes = item.Type === 'Series' && unplayed > 0;
  const recentlyAdded = isRecentlyAdded(item.DateCreated);
  const title = asSeries ? item.SeriesName! : item.Name;
  const href = catalogHref(item);
  const playable = Boolean(onPlay) && !upcoming;

  const previewEnabled = holdsSlot && previewsAllowed && !compact && !upcoming && !item.IsFolder;
  const previewState = useMediaPreview({
    itemId: item.Id,
    runtimeTicks: item.RunTimeTicks,
    enabled: previewEnabled,
    videoRef,
  });
  const showPreview = previewEnabled && previewState === 'playing';

  // The panel's fact line, as the site writes it: a certificate box, then a
  // season count for a series or a runtime for anything else. Episodes lead
  // with their label and a resume bar instead.
  const runtimeSeconds = ticksToSeconds(item.RunTimeTicks);
  const resumeSeconds = ticksToSeconds(item.UserData?.PlaybackPositionTicks);
  const seasons = item.Type === 'Series' ? item.ChildCount : undefined;
  const facts = [
    formatCertificate(item.OfficialRating),
    seasons && seasons > 0
      ? `${seasons} Season${seasons === 1 ? '' : 's'}`
      : formatRuntimeShort(runtimeSeconds),
  ].filter(Boolean);
  const panel: TilePanelContent = {
    // A caller-supplied subtitle (the upcoming rails pass a countdown) takes
    // the prominent line; otherwise episodes lead with their own label.
    episodeLabel: subtitle
      ?? (item.Type === 'Episode' && item.ParentIndexNumber != null && item.IndexNumber != null
        // The site quotes the episode name: S1:E9 "Trial by Fire".
        ? `S${item.ParentIndexNumber}:E${item.IndexNumber} “${item.Name}”`
        : null),
    // Music has neither a certificate nor a useful runtime here, so it falls
    // back to the artist line the classic caption used.
    facts: facts.length > 0 ? facts : [metaLine(item, asSeries)],
    tags: (item.Genres ?? []).slice(0, 3),
    progressPct: progress ?? undefined,
    resumeLabel: resumeSeconds > 0 && runtimeSeconds > 0
      ? `${formatRuntimeShort(resumeSeconds)} of ${formatRuntimeShort(runtimeSeconds)}`
      : null,
  };

  return (
    <div
      className={cn(
        // The tile is the layout box and never changes size — the popover
        // grows out of .hpr-cine-face instead, so nothing around it moves.
        // `flat` opts out of the popover entirely (grids, not rows).
        'group relative shrink-0',
        !flat && 'hpr-cine-tile',
        cardAspectClass(shape),
        // A rail sizes its own tiles; a grid sizes them from the column, and
        // the responsive w-[...] ladder overrode a caller's w-full, so grid
        // cells rendered 292px wide in a 240px column and overlapped.
        !flat && WIDTH_CLASS[shape],
        className,
      )}
      onPointerEnter={(event) => {
        // Pointer only: a touch "hover" would start a stream on tap.
        if (event.pointerType !== 'mouse') return;
        window.clearTimeout(hoverTimer.current);
        // Long enough that scanning a row costs nothing; the expand itself
        // lands at 300ms, so the clip arrives once you have clearly stopped.
        hoverTimer.current = window.setTimeout(() => setHovering(true), 1400);
      }}
      onPointerLeave={() => {
        window.clearTimeout(hoverTimer.current);
        setHovering(false);
      }}
    >
      <div className="hpr-cine-face bg-white/5">
      <div className="hpr-cine-art">
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

        {/* Always mounted while the slot is held so the player has somewhere to
            attach; revealed only once it reports playing, so a failure simply
            leaves the artwork. */}
        {previewEnabled && (
          <video
            ref={videoRef}
            muted
            playsInline
            aria-hidden
            className={cn(
              'pointer-events-none absolute inset-0 h-full w-full object-cover transition-opacity duration-500',
              showPreview ? 'opacity-100' : 'opacity-0',
            )}
          />
        )}

        {/* Touch has no hover, so a 16:9 still needs its title written on it.
            A portrait poster does not: the title is part of the artwork, which
            is exactly why the Netflix app runs bare posters on phones. */}
        {shape === 'landscape' && (
          <>
            <span className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/5 bg-gradient-to-t from-black/85 to-transparent',
              !flat && '[@media(hover:hover)]:hidden',
            )} />
            <span className={cn(
              'pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 text-[11px] font-medium text-white',
              !flat && '[@media(hover:hover)]:hidden',
            )}>
              <span className="line-clamp-2">{title}</span>
            </span>
          </>
        )}

        {upcoming && (
          <span className="absolute top-2 left-2 z-20 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide text-white uppercase backdrop-blur-md">
            Upcoming
          </span>
        )}
        {/* The site's badge vocabulary, not a media manager's. A bare unplayed
            count and a green tick have no equivalent on it; what it does show
            is a red "Recently added" ribbon and a two-tier "New Episode /
            Watch Now" flag, which is what an unwatched count on a series
            actually means. Watched state is already carried by the resume bar
            and by the panel, so the tick is dropped here entirely. */}
        {/* Ribbons are rail furniture — in a grid they land on top of the
            card's own title, and the site's overlay grid carries none.

            Measured off the site's artwork (the badges are baked into its
            boxart, so there is no DOM to read): horizontally centred, inset a
            few pixels from the bottom edge, laid out as a pair on 16:9 and
            stacked on a poster, and sized to about 60% of the card's width.
            It used to hug the bottom-left corner at one fixed size and ate a
            chunk of the phone poster. */}
        {flat || !(hasNewEpisodes || recentlyAdded) ? null : (
          <span className="pointer-events-none absolute inset-x-0 bottom-1 z-20 flex justify-center">
            <span
              className={cn(
                'flex overflow-hidden leading-none font-semibold *:text-center',
                shape === 'landscape'
                  ? 'flex-row text-[10px] *:px-2.5 *:py-[3px]'
                  : 'flex-col text-[9px] *:px-1.5 *:py-[2px]',
              )}
            >
              {hasNewEpisodes ? (
                <>
                  <span className="bg-[#e50914] text-white">New Episode</span>
                  <span className="bg-white text-black">Watch Now</span>
                </>
              ) : (
                <span className="bg-[#e50914] text-white">Recently added</span>
              )}
            </span>
          </span>
        )}

        {typeof progress === 'number' && progress > 0 && progress < 100 && (
          <div className="absolute inset-x-0 bottom-0 z-30 h-[3px] bg-white/25">
            {/* Netflix red, matching watch-modal and mobile-detail-tabs. The
                skin's white accent belongs on chrome, not on the resume bar. */}
            <div className="h-full bg-[#e50914]" style={{ width: `${Math.min(progress, 100)}%` }} />
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

      {!flat && (
      <TilePanel
        title={title}
        content={panel}
        onPlay={playable ? () => onPlay?.(item) : undefined}
        onToggleMyList={canFavorite ? () => favorite.toggle() : undefined}
        inMyList={favorite.isFavorite}
        onMoreInfo={() => { if (!modal?.open(item.Id)) router.push(href); }}
      />
      )}
      </div>

      {/* Stretched link: one tab stop for the whole tile, and focus-within on
          the tile is what opens the popover for keyboard users. */}
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
