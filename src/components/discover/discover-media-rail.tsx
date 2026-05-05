'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Star, Film, Tv, Check } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverItem } from '@/types';

interface DiscoverMediaRailProps {
  title: string;
  items: DiscoverItem[];
}

export function DiscoverMediaRail({ title, items }: DiscoverMediaRailProps) {
  if (!items.length) return null;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <span className="reel" aria-hidden />
        <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
          {title}
        </h2>
        <span className="hairline flex-1" aria-hidden />
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {items.map((item) => {
          const posterSrc = item.posterPath
            ? toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath
            : null;
          const href = `/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`;
          return (
            <Link
              key={`${item.mediaType}-${item.tmdbId}`}
              href={href}
              className="group press-feedback relative min-w-[124px] w-[124px] sm:min-w-[148px] sm:w-[148px] text-left shrink-0"
            >
              <div
                className="relative aspect-[2/3] overflow-hidden bg-muted/40 transition-all duration-500 group-hover:shadow-[0_18px_38px_-18px_var(--amber-glow)]"
                style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
              >
                <div
                  aria-hidden
                  className="absolute inset-0 z-20 pointer-events-none transition-colors duration-300 group-hover:border-[color:var(--amber-soft)]"
                  style={{ borderRadius: 'inherit', border: '1px solid var(--hairline)' }}
                />
                {posterSrc ? (
                  <Image
                    src={posterSrc}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 35vw, 148px"
                    className="object-cover transition-transform duration-[700ms] ease-out group-hover:scale-[1.06]"
                    unoptimized={isProtectedApiImageSrc(posterSrc)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
                    {item.mediaType === 'movie' ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--ink-deep)]/95 via-[color:var(--ink-deep)]/30 to-transparent" />
                <div className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100 bg-gradient-to-tr from-[color:var(--amber-soft)] via-transparent to-transparent" />

                <div className="absolute top-2 left-2 z-10">
                  <span
                    className="tracked-caps text-[8.5px] px-1.5 py-0.5 bg-black/60 text-white/90 backdrop-blur-sm border border-white/10"
                    style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                  >
                    {item.mediaType === 'movie' ? 'Film' : 'Series'}
                  </span>
                </div>

                {item.library?.exists && (
                  <div
                    className="absolute top-2 right-2 z-10 flex items-center justify-center h-5 w-5 backdrop-blur-sm"
                    style={{
                      borderRadius: '3px',
                      background: 'oklch(0.72 0.13 162 / 0.92)',
                      boxShadow: '0 0 0 1px oklch(0.72 0.13 162 / 0.6)',
                    }}
                  >
                    <Check className="h-3 w-3 text-[color:var(--ink-deep)]" strokeWidth={3} />
                  </div>
                )}

                <div className="absolute bottom-0 left-0 right-0 z-10 p-2.5 space-y-0.5">
                  <p className="font-display text-[13px] sm:text-[14px] leading-tight text-white line-clamp-2" style={{ letterSpacing: '-0.015em' }}>
                    {item.title}
                  </p>
                  <div className="flex items-center justify-between font-mono tabular text-[9.5px] text-white/70">
                    <span className="tracked-mid" style={{ letterSpacing: '0.14em' }}>{item.year ?? '----'}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-[color:var(--amber)] text-[color:var(--amber)]" />
                      {item.rating.toFixed(1)}
                    </span>
                  </div>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
