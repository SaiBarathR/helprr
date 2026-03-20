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
    <div>
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {items.map((item) => {
          const posterSrc = item.posterPath
            ? toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath
            : null;
          const href = `/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`;
          return (
            <Link
              key={`${item.mediaType}-${item.tmdbId}`}
              href={href}
              className="group relative min-w-[110px] w-[110px] sm:min-w-[130px] sm:w-[130px] text-left shrink-0"
            >
              <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted/60 border border-border/40">
                {posterSrc ? (
                  <Image
                    src={posterSrc}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 35vw, 130px"
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized={isProtectedApiImageSrc(posterSrc)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    {item.mediaType === 'movie' ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute top-1.5 left-1.5 flex items-center justify-center h-5 w-5 rounded-md bg-black/60">
                  {item.mediaType === 'movie'
                    ? <Film className="h-3 w-3 text-blue-400" />
                    : <Tv className="h-3 w-3 text-violet-400" />}
                </div>
                {item.library?.exists && (
                  <div className="absolute top-1.5 right-1.5 flex items-center justify-center h-5 w-5 rounded-md bg-green-600/80">
                    <Check className="h-3 w-3 text-white" />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-xs text-white font-medium line-clamp-2 leading-tight">{item.title}</p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-white/80">
                    <span>{item.year ?? '----'}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
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
