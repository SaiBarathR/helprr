'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import type { MediaImage } from '@/types';
import type { PosterSize } from '@/lib/store';

function getImageUrl(images: MediaImage[], coverType: string): string | null {
  const img = images.find((i) => i.coverType === coverType);
  return img?.remoteUrl || img?.url || null;
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const posterSizeClasses: Record<PosterSize, string> = {
  small: 'w-12 sm:w-14',
  medium: 'w-16 sm:w-20',
  large: 'w-20 sm:w-28',
};

export interface MediaOverviewItemProps {
  title: string;
  year: number;
  images: MediaImage[];
  href: string;
  type: 'movie' | 'series';
  monitored?: boolean;
  visibleFields: string[];
  posterSize?: PosterSize;
  // Optional data fields
  qualityProfile?: string;
  network?: string;
  studio?: string;
  certification?: string;
  overview?: string;
  rating?: number;
  sizeOnDisk?: number;
  runtime?: number;
  episodeProgress?: string;
  genres?: string[];
  hasFile?: boolean;
  status?: string;
  onNavigate?: () => void;
}

export function MediaOverviewItem({
  title,
  year,
  images,
  href,
  type,
  monitored,
  visibleFields,
  posterSize = 'medium',
  qualityProfile,
  network,
  studio,
  certification,
  overview,
  rating,
  sizeOnDisk,
  runtime,
  episodeProgress,
  genres,
  onNavigate,
}: MediaOverviewItemProps) {
  const poster = getImageUrl(images, 'poster');
  const show = (field: string) => visibleFields.includes(field);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="flex gap-3 rounded-xl bg-card p-3 hover:bg-muted/30 active:bg-muted/50 transition-colors"
    >
      {/* Poster thumbnail */}
      {show('images') ? (
        <div className={cn('relative shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-muted', posterSizeClasses[posterSize])}>
          {poster ? (
            <Image src={poster} alt={title} fill sizes="(max-width: 640px) 80px, 112px" className="object-cover" />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              {type === 'movie' ? <Film className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
            </div>
          )}
          {monitored === false && <div className="absolute inset-0 bg-black/40" />}
        </div>
      ) : null}

      {/* Metadata */}
      <div className="flex-1 min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          {show('monitored') && (
            monitored ? (
              <Eye className="h-3.5 w-3.5 text-primary shrink-0" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            )
          )}
          <h3 className="text-sm font-medium truncate">{title}</h3>
          {show('year') && <span className="text-xs text-muted-foreground shrink-0">({year})</span>}
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap gap-1.5">
          {show('qualityProfile') && qualityProfile && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{qualityProfile}</Badge>
          )}
          {show('network') && network && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{network}</Badge>
          )}
          {show('studio') && studio && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{studio}</Badge>
          )}
          {certification && show('certification') && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{certification}</Badge>
          )}
          {show('rating') && rating !== undefined && rating > 0 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
              {typeof rating === 'number' ? rating.toFixed(1) : rating}
            </Badge>
          )}
          {show('episodeProgress') && episodeProgress && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{episodeProgress}</Badge>
          )}
          {show('sizeOnDisk') && sizeOnDisk !== undefined && sizeOnDisk > 0 && (
            <span className="text-[10px] text-muted-foreground">{formatBytes(sizeOnDisk)}</span>
          )}
          {show('runtime') && runtime !== undefined && runtime > 0 && (
            <span className="text-[10px] text-muted-foreground">{runtime}m</span>
          )}
          {show('genres') && genres && genres.length > 0 && (
            <span className="text-[10px] text-muted-foreground">{genres.slice(0, 3).join(', ')}</span>
          )}
        </div>

        {/* Overview text */}
        {show('overview') && overview && (
          <p className="text-xs text-muted-foreground line-clamp-2">{overview}</p>
        )}
      </div>
    </Link>
  );
}
