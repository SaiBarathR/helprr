'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Check, Play } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { TilePanel } from '@/components/jellyfin-streaming/cinematic/tile-panel';
import { useCompactViewport } from '@/lib/hooks/use-compact-viewport';
import { cardAspectClass, type CatalogCardShape } from '@/lib/jellyfin-playback/image';
import { cn } from '@/lib/utils';

export type TileTone = 'green' | 'blue' | 'amber' | 'purple';

const TONE_CLASS: Record<TileTone, string> = {
  green: 'text-[var(--hpr-green)]',
  blue: 'text-[var(--hpr-blue)]',
  amber: 'text-[var(--hpr-amber)]',
  purple: 'text-[var(--hpr-purple)]',
};

/**
 * Cinematic tiles are materially bigger: with the caption gone the artwork is
 * the only thing carrying the title, so it has to be large enough to read.
 */
const WIDTH: Record<'classic' | 'cinematic', Record<CatalogCardShape, string>> = {
  classic: {
    portrait: 'w-[110px] sm:w-[140px] md:w-[150px] lg:w-[164px] xl:w-[180px] 2xl:w-[196px]',
    square: 'w-[110px] sm:w-[140px] md:w-[150px] lg:w-[164px] xl:w-[180px] 2xl:w-[196px]',
    landscape: 'w-[184px] sm:w-[224px] md:w-[240px] lg:w-[264px] xl:w-[288px] 2xl:w-[312px]',
  },
  cinematic: {
    portrait: 'w-[112px] sm:w-[132px] md:w-[148px] lg:w-[160px] xl:w-[176px] 2xl:w-[196px]',
    square: 'w-[112px] sm:w-[132px] md:w-[148px] lg:w-[160px] xl:w-[176px] 2xl:w-[196px]',
    landscape: 'w-[168px] sm:w-[196px] md:w-[220px] lg:w-[240px] xl:w-[262px] 2xl:w-[292px]',
  },
};

export interface TileBadge {
  label: string;
  tone: TileTone;
}

export interface MediaTileProps {
  title: string;
  imageUrl: string | null;
  /**
   * 16:9 artwork, used when the tile resolves to a landscape frame. Rails that
   * only have a poster can leave it out — the poster is then cropped, which is
   * what the tile did for every shape before.
   */
  landscapeUrl?: string | null;
  /** Caption lines in the classic skin; hover-reveal lines in the cinematic one. */
  lines?: Array<string | null | undefined>;
  /** Dot-separated tags for the cinematic popover, as the site shows genres. */
  tags?: string[];
  href?: string;
  /** Tiles that act rather than navigate (a trailer thumbnail plays in place). */
  onActivate?: () => void;
  shape?: CatalogCardShape;
  unoptimized?: boolean;
  priority?: boolean;
  topLeftBadge?: TileBadge;
  bottomLeftBadge?: TileBadge;
  watched?: boolean;
  progressPct?: number;
  /** Centre play affordance, for tiles whose whole purpose is playback. */
  playAffordance?: boolean;
  className?: string;
}

/**
 * The one media tile in the Watch section, for every rail that isn't rendering
 * a raw Jellyfin item (upcoming from the arr calendar, Helprr's own
 * recommendations, trailers).
 *
 * Classic keeps the captioned, bordered card. Cinematic drops the caption —
 * the art is the label — and moves it into a hover reveal on pointer devices
 * and a permanent scrim on touch, where there is no hover to reach it.
 */
export function MediaTile({
  title,
  imageUrl,
  landscapeUrl,
  lines = [],
  tags,
  href,
  onActivate,
  shape: requestedShape,
  unoptimized = true,
  priority = false,
  topLeftBadge,
  bottomLeftBadge,
  watched = false,
  progressPct,
  playAffordance = false,
  className,
}: MediaTileProps) {
  const skin = useWatchSkin();
  const cinematic = skin === 'cinematic';
  const compact = useCompactViewport();
  const router = useRouter();
  // The site's desktop rows are 16:9 for everything; portrait is its phone
  // treatment. Classic keeps the captioned portrait card it has always had.
  // An explicit shape from the caller wins over both.
  const requested = requestedShape ?? (cinematic ? 'landscape' : 'portrait');
  // Phone rails are portrait in the Netflix app; 16:9 starts at tablet.
  const shape = cinematic && compact && requested === 'landscape' ? 'portrait' : requested;
  const src = shape === 'landscape' ? (landscapeUrl ?? imageUrl) : imageUrl;
  const captions = lines.filter((line): line is string => Boolean(line));
  const badgeShape = cinematic ? 'rounded bg-black/60' : 'rounded-md border border-white/15 bg-black/45';

  // Cinematic splits the frame into face + art so the hover popover can grow
  // out of it without disturbing the row; classic keeps the single frame it
  // has always had. The contents are identical either way.
  const frame = (
    <>
        {src ? (
          <FadeInImage
            src={src}
            alt={title}
            fill
            sizes={shape === 'landscape' ? '344px' : '220px'}
            priority={priority}
            unoptimized={unoptimized}
            className={cn(
              'object-cover',
              !cinematic && 'transition-transform duration-300 group-hover:scale-[1.04]',
            )}
          />
        ) : (
          <div className="flex h-full items-center justify-center p-2 text-center text-xs text-muted-foreground">
            {title}
          </div>
        )}

        {!cinematic && (
          <span className="pointer-events-none absolute inset-0 z-20 bg-black/0 transition-colors group-hover:bg-black/35" />
        )}

        {cinematic && shape === 'landscape' && (
          // Touch has no hover, so a 16:9 still needs its title written on it.
          // A portrait poster does not — the title is part of the artwork,
          // which is why the app runs bare posters on phones. Gated the same
          // way as CinematicCard so the two never disagree on one screen.
          <>
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-2/5 bg-gradient-to-t from-black/85 to-transparent [@media(hover:hover)]:hidden" />
            {/* pr-12 keeps the title clear of the touch play affordance. */}
            <span className="pointer-events-none absolute inset-x-0 bottom-0 z-10 p-2 pr-12 text-[11px] font-medium text-white [@media(hover:hover)]:hidden">
              <span className="line-clamp-2">{title}</span>
            </span>
          </>
        )}

        {topLeftBadge && (
          <span
            className={cn(
              'absolute top-2 left-2 z-20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase backdrop-blur-md',
              badgeShape,
              cinematic ? 'text-white' : TONE_CLASS[topLeftBadge.tone],
            )}
          >
            {topLeftBadge.label}
          </span>
        )}

        {watched && (
          <span
            className={cn(
              'absolute top-2 right-2 z-20 flex size-5 items-center justify-center rounded-full text-[var(--hpr-green)] backdrop-blur-md',
              cinematic ? 'bg-black/60' : 'border border-white/15 bg-black/45',
            )}
            title="Watched"
          >
            <Check className="size-3.5" strokeWidth={3} />
          </span>
        )}

        {bottomLeftBadge && (
          <span
            className={cn(
              'absolute bottom-2 left-2 z-20 px-1.5 py-0.5 text-[10px] font-semibold tracking-wide uppercase backdrop-blur-md',
              badgeShape,
              cinematic ? 'text-white' : TONE_CLASS[bottomLeftBadge.tone],
            )}
          >
            {bottomLeftBadge.label}
          </span>
        )}

        {playAffordance && (
          <span className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center">
            <span
              className={cn(
                'flex size-10 items-center justify-center rounded-full backdrop-blur',
                cinematic
                  ? 'bg-white/90 text-black'
                  : 'border border-border/50 bg-background/70 text-foreground',
              )}
            >
              <Play className="size-4 fill-current" />
            </span>
          </span>
        )}

        {typeof progressPct === 'number' && progressPct > 0 && progressPct < 100 && (
          <div
            className={cn(
              'absolute inset-x-0 bottom-0 z-30',
              cinematic ? 'h-[3px] bg-white/25' : 'h-1.5 bg-black/45 backdrop-blur-sm',
            )}
          >
            <div
              // Cinematic resume bars are Netflix red, as in watch-modal and
              // mobile-detail-tabs; classic keeps the app's accent.
              className={cn('h-full', cinematic ? 'bg-[#e50914]' : 'bg-[var(--hpr-amber)]')}
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
        )}
    </>
  );

  return (
    <div
      className={cn(
        'group relative shrink-0',
        cinematic && ['hpr-cine-tile', cardAspectClass(shape)],
        WIDTH[cinematic ? 'cinematic' : 'classic'][shape],
        className,
      )}
    >
      {cinematic ? (
        <div className="hpr-cine-face bg-white/5">
          <div className="hpr-cine-art">{frame}</div>
          {/* Same panel component as the Jellyfin card, so a recommendation
              row and a Continue watching row read identically. These rails
              have no Jellyfin item behind them — an unreleased film is not in
              the library at all — so there is nothing to play or expand, and
              the panel renders facts only. */}
          <TilePanel
            title={title}
            content={{ episodeLabel: title, tags: tags ?? captions, progressPct }}
            onMoreInfo={href ? () => router.push(href) : undefined}
          />
        </div>
      ) : (
        <div className={cn('relative overflow-hidden rounded-xl border border-border/40 bg-muted/60', cardAspectClass(shape))}>
          {frame}
        </div>
      )}

      {!cinematic && (
        <>
          <p className="mt-2 truncate text-sm font-medium">{title}</p>
          {captions.map((line, index) => (
            <p
              key={line}
              className={cn(
                'truncate text-[11px]',
                // The arr rails put the airtime last and want it emphasised.
                index === captions.length - 1 && captions.length > 1
                  ? 'font-medium text-foreground/80'
                  : 'text-muted-foreground',
              )}
            >
              {line}
            </p>
          ))}
        </>
      )}

      {/* One tab stop for the whole tile, and no interactive element nested
          inside an anchor. focus-within on the tile opens the reveal for
          keyboard users. */}
      {href ? (
        <Link
          href={href}
          aria-label={title}
          className={cn(
            'absolute inset-0 z-10 focus-visible:outline-none',
            cinematic
              ? 'rounded-xl focus-visible:ring-2 focus-visible:ring-white'
              : 'rounded-xl focus-visible:ring-2 focus-visible:ring-[var(--hpr-amber)]',
          )}
        />
      ) : onActivate ? (
        <button
          type="button"
          onClick={onActivate}
          aria-label={title}
          className={cn(
            'absolute inset-0 z-10 focus-visible:outline-none',
            cinematic
              ? 'rounded-xl focus-visible:ring-2 focus-visible:ring-white'
              : 'rounded-xl focus-visible:ring-2 focus-visible:ring-[var(--hpr-amber)]',
          )}
        />
      ) : null}
    </div>
  );
}
