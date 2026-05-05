'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Star } from 'lucide-react';
import type { MediaImage } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';

interface MediaCardProps {
  title: string;
  year: number;
  images: MediaImage[];
  status?: string;
  hasFile?: boolean;
  monitored?: boolean;
  type: 'movie' | 'series';
  href: string;
  visibleFields?: string[];
  rating?: number;
  onNavigate?: () => void;
}

function getImageUrl(
  images: MediaImage[],
  coverType: string,
  serviceHint?: ImageServiceHint
): string | null {
  const img = images.find((i) => i.coverType === coverType);
  const raw = img?.remoteUrl || img?.url || null;
  return toCachedImageSrc(raw, serviceHint);
}

export function MediaCard({
  title,
  year,
  images,
  hasFile,
  monitored,
  type,
  href,
  visibleFields,
  rating,
  onNavigate,
}: MediaCardProps) {
  const poster = getImageUrl(images, 'poster', type === 'movie' ? 'radarr' : 'sonarr');
  const show = (field: string) => !visibleFields || visibleFields.includes(field);

  return (
    <Link href={href} onClick={onNavigate} className="group block press-feedback">
      <div
        className="relative aspect-[2/3] overflow-hidden bg-muted/40 transition-all duration-500 ease-out group-hover:shadow-[0_18px_38px_-18px_var(--amber-glow)]"
        style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
      >
        {/* Hairline frame */}
        <div
          aria-hidden
          className="absolute inset-0 z-20 pointer-events-none transition-colors duration-300 group-hover:border-[color:var(--amber-soft)]"
          style={{ borderRadius: 'inherit', border: '1px solid var(--hairline)' }}
        />

        {poster ? (
          <Image
            src={poster}
            alt={title}
            fill
            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 16vw"
            className="object-cover transition-transform duration-[700ms] ease-out group-hover:scale-[1.06]"
            unoptimized={isProtectedApiImageSrc(poster)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
            {type === 'movie' ? <Film className="h-9 w-9" /> : <Tv className="h-9 w-9" />}
          </div>
        )}

        {/* Cinematic gradient */}
        <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--ink-deep)]/95 via-[color:var(--ink-deep)]/30 to-transparent" />
        {/* Hover amber wash */}
        <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-tr from-[color:var(--amber-soft)] via-transparent to-transparent" />

        {/* Top-right rating */}
        {show('rating') && rating !== undefined && rating > 0 && (
          <div
            className="absolute top-1.5 right-1.5 z-10 inline-flex items-center gap-0.5 px-1 py-0.5 bg-black/65 backdrop-blur-sm border border-white/10"
            style={{ borderRadius: '3px' }}
          >
            <Star className="h-2.5 w-2.5 text-[color:var(--amber)] fill-[color:var(--amber)]" />
            <span className="text-[9px] text-white font-mono tabular tracking-tight">{rating.toFixed(1)}</span>
          </div>
        )}

        {/* Bottom: title + year */}
        <div className="absolute bottom-0 left-0 right-0 z-10 p-2 space-y-0.5">
          <p className="font-display text-[12.5px] sm:text-[13.5px] leading-tight text-white line-clamp-2" style={{ letterSpacing: '-0.015em' }}>
            {title}
          </p>
          {show('year') && (
            <p className="font-mono tabular text-[9.5px] text-white/65 tracked-mid" style={{ letterSpacing: '0.14em' }}>
              {year || '----'}
            </p>
          )}
        </div>

        {/* Status indicator — bottom-right amber/sage/red */}
        {show('monitored') && hasFile !== undefined && (
          <div className="absolute top-1.5 left-1.5 z-10 flex items-center gap-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: hasFile
                  ? 'oklch(0.78 0.13 162)'
                  : monitored
                    ? 'oklch(0.66 0.20 25)'
                    : 'oklch(0.55 0.012 75)',
                boxShadow: hasFile
                  ? '0 0 0 2px oklch(0.78 0.13 162 / 0.18), 0 0 6px oklch(0.78 0.13 162 / 0.5)'
                  : monitored
                    ? '0 0 0 2px oklch(0.66 0.20 25 / 0.18), 0 0 6px oklch(0.66 0.20 25 / 0.4)'
                    : 'none',
              }}
            />
          </div>
        )}

        {/* Unmonitored overlay */}
        {show('monitored') && monitored === false && (
          <div className="absolute inset-0 bg-[color:var(--ink-deep)]/55 z-[5]" />
        )}
      </div>
    </Link>
  );
}

export { getImageUrl };
