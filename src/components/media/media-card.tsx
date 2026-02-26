'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Star } from 'lucide-react';
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
  visibleFields?: string[];
  rating?: number;
  onNavigate?: () => void;
}

function getImageUrl(images: MediaImage[], coverType: string): string | null {
  const img = images.find((i) => i.coverType === coverType);
  return img?.remoteUrl || img?.url || null;
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
  const poster = getImageUrl(images, 'poster');
  const show = (field: string) => !visibleFields || visibleFields.includes(field);

  return (
    <Link href={href} onClick={onNavigate} className="group block">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted shadow-sm">
        {poster ? (
          <Image
            src={poster}
            alt={title}
            fill
            sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 16vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {type === 'movie' ? <Film className="h-10 w-10" /> : <Tv className="h-10 w-10" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-2">
          <p className="text-xs font-semibold text-white truncate leading-tight">{title}</p>
          {show('year') && <p className="text-[10px] text-white/70">{year}</p>}
        </div>
        {/* Rating badge - top right */}
        {show('rating') && rating !== undefined && rating > 0 && (
          <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-black/60 rounded px-1 py-0.5">
            <Star className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400" />
            <span className="text-[9px] text-white font-medium">{rating.toFixed(1)}</span>
          </div>
        )}
        {/* Status dot - bottom right */}
        {show('monitored') && hasFile !== undefined && (
          <div className="absolute bottom-1.5 right-1.5">
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                hasFile ? 'bg-green-500' : monitored ? 'bg-red-500' : 'bg-zinc-500'
              }`}
            />
          </div>
        )}
        {/* Unmonitored overlay */}
        {show('monitored') && monitored === false && (
          <div className="absolute inset-0 bg-black/40" />
        )}
      </div>
    </Link>
  );
}

export { getImageUrl };
