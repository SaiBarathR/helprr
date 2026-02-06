'use client';

import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { Film, Tv, Eye, EyeOff } from 'lucide-react';
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
      <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
        {poster ? (
          <img
            src={poster}
            alt={title}
            className="absolute inset-0 w-full h-full object-cover transition-transform duration-300 group-hover:scale-105"
            loading="lazy"
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            {type === 'movie' ? <Film className="h-12 w-12" /> : <Tv className="h-12 w-12" />}
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-transparent to-transparent" />
        <div className="absolute bottom-0 left-0 right-0 p-3">
          <p className="text-sm font-semibold text-white truncate">{title}</p>
          <p className="text-xs text-white/70">{year}</p>
        </div>
        <div className="absolute top-2 right-2 flex gap-1">
          {monitored !== undefined && (
            <Badge variant="secondary" className="h-5 px-1 bg-black/60 text-white border-0">
              {monitored ? <Eye className="h-3 w-3" /> : <EyeOff className="h-3 w-3" />}
            </Badge>
          )}
          {hasFile !== undefined && (
            <Badge
              variant="secondary"
              className={`h-5 px-1.5 text-[10px] border-0 ${
                hasFile ? 'bg-green-500/80 text-white' : 'bg-red-500/80 text-white'
              }`}
            >
              {hasFile ? 'On Disk' : 'Missing'}
            </Badge>
          )}
        </div>
      </div>
    </Link>
  );
}

export { getImageUrl };
