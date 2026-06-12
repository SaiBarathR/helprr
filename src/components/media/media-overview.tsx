'use client';

import { memo } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Disc3, Eye, EyeOff } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn, shallowEqualExcept } from '@/lib/utils';
import type { MediaImage } from '@/types';
import type { PosterSize } from '@/lib/store';
import { isProtectedApiImageSrc, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import { SelectionCheck } from './selection-check';

function getImageUrl(
  images: MediaImage[],
  coverType: string,
  serviceHint?: ImageServiceHint
): string | null {
  const img = images.find((i) => i.coverType === coverType);
  const raw = img?.remoteUrl || img?.url || null;
  return toCachedImageSrc(raw, serviceHint);
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
  type: 'movie' | 'series' | 'artist';
  monitored?: boolean;
  visibleFields: string[];
  posterSize?: PosterSize;
  // Optional data fields
  qualityProfile?: string;
  metadataProfile?: string;
  network?: string;
  studio?: string;
  certification?: string;
  overview?: string;
  rating?: number;
  sizeOnDisk?: number;
  runtime?: number;
  episodeProgress?: string;
  // Music (artist) fields
  artistType?: string;
  albumCount?: number;
  trackProgress?: string;
  genres?: string[];
  hasFile?: boolean;
  status?: string;
  /** Instance label shown only when >1 instance of the type is connected. */
  instanceLabel?: string;
  onNavigate?: () => void;
  /** Selection mode: clicking the row toggles selection instead of navigating. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
}

export const MediaOverviewItem = memo(function MediaOverviewItem({
  title,
  year,
  images,
  href,
  type,
  monitored,
  visibleFields,
  posterSize = 'medium',
  qualityProfile,
  metadataProfile,
  network,
  studio,
  certification,
  overview,
  rating,
  sizeOnDisk,
  runtime,
  episodeProgress,
  artistType,
  albumCount,
  trackProgress,
  genres,
  instanceLabel,
  onNavigate,
  selectable,
  selected,
  onToggleSelect,
}: MediaOverviewItemProps) {
  const posterHint = type === 'movie' ? 'radarr' : type === 'artist' ? 'lidarr' : 'sonarr';
  const poster = getImageUrl(images, 'poster', posterHint);
  const show = (field: string) => visibleFields.includes(field);

  const rowClass = cn(
    'flex gap-3 rounded-xl bg-card p-3 transition-colors',
    selectable && selected
      ? 'ring-2 ring-primary bg-primary/5'
      : 'hover:bg-muted/30 active:bg-muted/50'
  );

  const body = (
    <>
      {selectable && (
        <div className="flex shrink-0 items-center">
          <SelectionCheck selected={Boolean(selected)} />
        </div>
      )}
      {/* Poster thumbnail */}
      {show('images') ? (
        <div className={cn('relative shrink-0 aspect-[2/3] rounded-lg overflow-hidden bg-muted', posterSizeClasses[posterSize])}>
          {poster ? (
            <Image
              src={poster}
              alt={title}
              fill
              sizes="(max-width: 640px) 80px, 112px"
              className="object-cover"
              unoptimized={isProtectedApiImageSrc(poster)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              {type === 'movie' ? <Film className="h-6 w-6" /> : type === 'artist' ? <Disc3 className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
            </div>
          )}
          {monitored === false && <div className="absolute inset-0 bg-background/40" />}
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
          {instanceLabel && (
            <span className="text-[10px] font-medium text-[var(--hpr-amber)] shrink-0">{instanceLabel}</span>
          )}
        </div>

        {/* Badges row */}
        <div className="flex flex-wrap gap-1.5">
          {show('qualityProfile') && qualityProfile && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{qualityProfile}</Badge>
          )}
          {show('metadataProfile') && metadataProfile && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{metadataProfile}</Badge>
          )}
          {show('artistType') && artistType && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{artistType}</Badge>
          )}
          {show('albumCount') && albumCount !== undefined && albumCount > 0 && (
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">{albumCount} albums</Badge>
          )}
          {show('trackProgress') && trackProgress && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">{trackProgress}</Badge>
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
    </>
  );

  if (selectable) {
    return (
      <button
        type="button"
        onClick={onToggleSelect}
        aria-pressed={Boolean(selected)}
        aria-label={`${selected ? 'Deselect' : 'Select'} ${title}`}
        className={cn(rowClass, 'w-full text-left')}
      >
        {body}
      </button>
    );
  }

  return (
    <Link href={href} onClick={onNavigate} className={rowClass}>
      {body}
    </Link>
  );
}, (p, n) => shallowEqualExcept(p, n, ['onNavigate', 'onToggleSelect']));
