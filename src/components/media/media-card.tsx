'use client';

import Link from 'next/link';
import { Film, Tv } from 'lucide-react';
import type { MediaImage } from '@/types';

interface MediaCardProps {
  title: string;
  year: number;
  images: MediaImage[];
  status?: string;
  hasFile?: boolean;
  monitored?: boolean;
  type: 'movie' | 'series';
  href: string;
}

function getImageUrl(images: MediaImage[], coverType: string): string | null {
  const img = images.find((i) => i.coverType === coverType);
  return img?.remoteUrl || img?.url || null;
}

export function MediaCard({ title, year, images, hasFile, monitored, type, href }: MediaCardProps) {
  const poster = getImageUrl(images, 'poster');

  return (
    <Link href={href} className="group block">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted shadow-sm">
        {poster ? (
          <img
            src={poster}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {type === 'movie' ? <Film className="h-10 w-10" /> : <Tv className="h-10 w-10" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-xs font-semibold text-white truncate leading-tight">{title}</p>
          <p className="text-[10px] text-white/70">{year}</p>
        </div>
        {/* Status badge - bottom right */}
        {hasFile !== undefined && (
          <div className="absolute bottom-1.5 right-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                hasFile ? 'bg-green-500' : monitored ? 'bg-red-500' : 'bg-zinc-500'
              }`}
            />
          </div>
        )}
        {/* Unmonitored overlay */}
        {monitored === false && (
          <div className="absolute inset-0 bg-black/40" />
        )}
      </div>
    </Link>
  );
}

export { getImageUrl };
