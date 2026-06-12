'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Disc3, Star } from 'lucide-react';
import { memo, type ReactNode } from 'react';
import type { MediaImage } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';
import { cn, shallowEqualExcept } from '@/lib/utils';
import { SelectionCheck } from './selection-check';

interface MediaCardProps {
  title: string;
  year: number;
  images: MediaImage[];
  status?: string;
  hasFile?: boolean;
  monitored?: boolean;
  type: 'movie' | 'series' | 'artist';
  href: string;
  visibleFields?: string[];
  rating?: number;
  /** Instance label shown only when >1 instance of the type is connected. */
  instanceLabel?: string;
  onNavigate?: () => void;
  cornerAction?: ReactNode;
  /** Selection mode: clicking the card toggles selection instead of navigating. */
  selectable?: boolean;
  selected?: boolean;
  onToggleSelect?: () => void;
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

export const MediaCard = memo(function MediaCard({
  title,
  year,
  images,
  hasFile,
  monitored,
  type,
  href,
  visibleFields,
  rating,
  instanceLabel,
  onNavigate,
  cornerAction,
  selectable,
  selected,
  onToggleSelect,
}: MediaCardProps) {
  const posterHint = type === 'movie' ? 'radarr' : type === 'artist' ? 'lidarr' : 'sonarr';
  const poster = getImageUrl(images, 'poster', posterHint);
  const show = (field: string) => !visibleFields || visibleFields.includes(field);

  const posterInner = (
    <div
      className={cn(
        'relative aspect-[2/3] rounded-xl overflow-hidden bg-muted shadow-sm',
        selectable && selected && 'ring-2 ring-primary ring-offset-2 ring-offset-background'
      )}
    >
      {poster ? (
            <Image
              src={poster}
              alt={title}
              fill
              sizes="(max-width: 640px) 33vw, (max-width: 1024px) 20vw, 16vw"
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(poster)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
              {type === 'movie' ? <Film className="h-10 w-10" /> : type === 'artist' ? <Disc3 className="h-10 w-10" /> : <Tv className="h-10 w-10" />}
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-background/70 via-transparent to-transparent" />
          <div className="absolute bottom-0 left-0 right-0 p-2">
            <p className="text-xs font-semibold text-foreground truncate leading-tight">{title}</p>
            {(show('year') || instanceLabel) && (
              <p className="text-[10px] text-foreground/70 truncate">
                {show('year') && year}
                {instanceLabel && (
                  <span className="text-[var(--hpr-amber)] font-medium">{show('year') ? ' · ' : ''}{instanceLabel}</span>
                )}
              </p>
            )}
          </div>
          {/* Rating badge - top right */}
          {show('rating') && rating !== undefined && rating > 0 && (
            <div className="absolute top-1.5 right-1.5 flex items-center gap-0.5 bg-background/60 rounded px-1 py-0.5">
              <Star className="h-2.5 w-2.5 text-yellow-400 fill-yellow-400" />
              <span className="text-[9px] text-foreground font-medium">{rating.toFixed(1)}</span>
            </div>
          )}
          {/* Status dot - bottom right */}
          {show('monitored') && hasFile !== undefined && (
            <div className="absolute bottom-1.5 right-1.5">
              <span
                className={`inline-block h-2 w-2 rounded-full ${
                  hasFile ? 'bg-green-500' : monitored ? 'bg-red-500' : 'bg-muted-foreground'
                }`}
              />
            </div>
          )}
      {/* Unmonitored overlay */}
      {show('monitored') && monitored === false && (
        <div className="absolute inset-0 bg-background/40" />
      )}
    </div>
  );

  return (
    <div className="group relative">
      {selectable ? (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={Boolean(selected)}
          aria-label={`${selected ? 'Deselect' : 'Select'} ${title}`}
          className="block w-full text-left"
        >
          {posterInner}
        </button>
      ) : (
        <Link href={href} onClick={onNavigate} className="block">
          {posterInner}
        </Link>
      )}
      {/* The corner slot sits OUTSIDE the Link/button so its onClick isn't routed
          through the anchor (no nested-interactive markup). In selection mode it
          shows the checkbox; otherwise the optional cornerAction. */}
      {selectable ? (
        <div className="absolute top-1.5 left-1.5 z-10">
          <SelectionCheck selected={Boolean(selected)} />
        </div>
      ) : cornerAction ? (
        <div className="absolute top-1.5 left-1.5 z-10">{cornerAction}</div>
      ) : null}
    </div>
  );
}, (p, n) => shallowEqualExcept(p, n, ['onNavigate', 'onToggleSelect', 'cornerAction']));

export { getImageUrl };
