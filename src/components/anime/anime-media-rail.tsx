'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ChevronRight, Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListMediaFormat, AniListMediaType } from '@/types/anilist';

interface MediaItem {
  id: number;
  title: string;
  coverImage: string | null;
  format?: AniListMediaFormat | null;
  averageScore?: number | null;
  episodes?: number | null;
  seasonYear?: number | null;
  type?: AniListMediaType | null;
  chapters?: number | null;
  volumes?: number | null;
}

interface AnimeMediaRailProps {
  title: string;
  items: MediaItem[];
  viewAllHref?: string;
  size?: 'default' | 'large';
}

export function AnimeMediaRail({ title, items, viewAllHref, size = 'default' }: AnimeMediaRailProps) {
  if (!items.length) return null;

  const cardWidth = size === 'large' ? 'w-[140px]' : 'w-[110px]';
  const imgSize = size === 'large' ? '140px' : '110px';

  return (
    <div className='px-2'>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {viewAllHref && (
          <Link href={viewAllHref} className="flex items-center gap-0.5 text-xs text-primary hover:underline font-medium">
            View All
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide snap-x snap-mandatory animate-rail-in">
        {items.map((item) => {
          const imgSrc = item.coverImage
            ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
            : null;

          const isManga = item.type === 'MANGA' || item.format === 'MANGA' || item.chapters != null || item.volumes != null;
          const href = isManga ? `/anime/manga/${item.id}` : `/anime/${item.id}`;
          const metadata: string[] = [];

          if (item.format) metadata.push(item.format.replace('_', ' '));

          if (isManga) {
            if (item.chapters != null) metadata.push(`${item.chapters} ch`);
            if (item.volumes != null) metadata.push(`${item.volumes} vol`);
          } else if (item.episodes != null) {
            metadata.push(`${item.episodes} eps`);
          }

          return (
            <Link
              key={item.id}
              href={href}
              className={`flex-shrink-0 ${cardWidth} group snap-start`}
            >
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted border border-border/30 group-hover:border-primary/40 transition-colors">
                {imgSrc ? (
                  <Image
                    src={imgSrc}
                    alt={item.title}
                    fill
                    sizes={imgSize}
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized={isProtectedApiImageSrc(imgSrc)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
                    {item.title}
                  </div>
                )}
                {item.averageScore != null && item.averageScore > 0 && (
                  <Badge className="absolute top-1 right-1 text-[9px] bg-black/60 text-white gap-0.5">
                    <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
                    {item.averageScore}%
                  </Badge>
                )}
              </div>
              <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
              <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                {metadata.join(' · ')}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
