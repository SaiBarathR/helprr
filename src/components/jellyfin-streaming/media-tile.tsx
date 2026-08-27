'use client';

import Link from 'next/link';
import { Check, Play } from 'lucide-react';
import { FadeInImage } from '@/components/media/fade-in-image';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
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
    portrait: 'w-[132px] sm:w-[156px] md:w-[172px] lg:w-[188px] xl:w-[204px] 2xl:w-[220px]',
    square: 'w-[132px] sm:w-[156px] md:w-[172px] lg:w-[188px] xl:w-[204px] 2xl:w-[220px]',
    landscape: 'w-[212px] sm:w-[248px] md:w-[272px] lg:w-[296px] xl:w-[320px] 2xl:w-[344px]',
  },
};

export interface TileBadge {
  label: string;
  tone: TileTone;
}

export interface MediaTileProps {
  title: string;
  imageUrl: string | null;
  /** Caption lines in the classic skin; hover-reveal lines in the cinematic one. */
  lines?: Array<string | null | undefined>;
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
  lines = [],
  href,
  onActivate,
  shape = 'portrait',
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
  const captions = lines.filter((line): line is string => Boolean(line));
  const badgeShape = cinematic ? 'rounded-sm bg-black/60' : 'rounded-md border border-white/15 bg-black/45';

  return (
    <div
      className={cn(
        'group relative shrink-0',
        cinematic && 'hpr-cine-tile',
        WIDTH[cinematic ? 'cinematic' : 'classic'][shape],
        className,
      )}
    >
      <div
        className={cn(
          'relative overflow-hidden',
          cardAspectClass(shape),
          cinematic ? 'rounded-sm bg-white/5' : 'rounded-xl border border-border/40 bg-muted/60',
        )}
      >
        {imageUrl ? (
          <FadeInImage
            src={imageUrl}
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

        {cinematic && (
          // Touch has no hover, so the title has to be permanently legible there.
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

        {cinematic && captions.length > 0 && (
          // Pointer-only reveal, riding the same intent delay as the tile's
          // expand (see .hpr-cine-reveal in globals.css).
          <span className="hpr-cine-reveal pointer-events-none absolute inset-0 z-20 hidden flex-col justify-end bg-gradient-to-t from-black/90 via-black/35 to-transparent p-2.5 opacity-0 transition-opacity duration-300 [@media(hover:hover)]:flex">
            <span className="block truncate text-[13px] font-semibold text-white">{title}</span>
            {captions.map((line) => (
              <span key={line} className="block truncate text-[11px] text-white/70">
                {line}
              </span>
            ))}
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
              className="h-full bg-[var(--hpr-amber)]"
              style={{ width: `${Math.min(progressPct, 100)}%` }}
            />
          </div>
        )}
      </div>

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
              ? 'rounded-sm focus-visible:ring-2 focus-visible:ring-white'
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
              ? 'rounded-sm focus-visible:ring-2 focus-visible:ring-white'
              : 'rounded-xl focus-visible:ring-2 focus-visible:ring-[var(--hpr-amber)]',
          )}
        />
      ) : null}
    </div>
  );
}
