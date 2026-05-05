'use client';

import Link from 'next/link';
import Image from 'next/image';
import { Film, Tv, Eye, EyeOff, Star } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { MediaImage } from '@/types';
import type { PosterSize } from '@/lib/store';
import { isProtectedApiImageSrc, toCachedImageSrc, type ImageServiceHint } from '@/lib/image';

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
  type: 'movie' | 'series';
  monitored?: boolean;
  visibleFields: string[];
  posterSize?: PosterSize;
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

function StatChip({ children }: { children: React.ReactNode }) {
  return (
    <span
      className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-card/40 border border-[color:var(--hairline)] tracked-caps text-[8.5px] text-muted-foreground"
      style={{ borderRadius: '3px', letterSpacing: '0.18em' }}
    >
      {children}
    </span>
  );
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
  hasFile,
  onNavigate,
}: MediaOverviewItemProps) {
  const poster = getImageUrl(images, 'poster', type === 'movie' ? 'radarr' : 'sonarr');
  const show = (field: string) => visibleFields.includes(field);

  return (
    <Link
      href={href}
      onClick={onNavigate}
      className="group flex gap-3 p-2.5 sm:p-3 bg-card/30 hover:bg-card/60 border border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] transition-all press-feedback"
      style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
    >
      {show('images') ? (
        <div
          className={cn(
            'relative shrink-0 aspect-[2/3] overflow-hidden bg-muted/40',
            posterSizeClasses[posterSize]
          )}
          style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
        >
          {poster ? (
            <Image
              src={poster}
              alt={title}
              fill
              sizes="(max-width: 640px) 80px, 112px"
              className="object-cover transition-transform duration-500 group-hover:scale-[1.04]"
              unoptimized={isProtectedApiImageSrc(poster)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/70">
              {type === 'movie' ? <Film className="h-6 w-6" /> : <Tv className="h-6 w-6" />}
            </div>
          )}
          <div
            aria-hidden
            className="absolute inset-0"
            style={{ border: '1px solid var(--hairline)', borderRadius: 'inherit' }}
          />
          {monitored === false && <div className="absolute inset-0 bg-[color:var(--ink-deep)]/50" />}
          {hasFile !== undefined && (
            <span
              className="absolute top-1 right-1 inline-block h-1.5 w-1.5 rounded-full"
              style={{
                background: hasFile
                  ? 'oklch(0.78 0.13 162)'
                  : monitored
                    ? 'oklch(0.66 0.20 25)'
                    : 'oklch(0.55 0.012 75)',
                boxShadow: hasFile
                  ? '0 0 6px oklch(0.78 0.13 162 / 0.6)'
                  : monitored
                    ? '0 0 6px oklch(0.66 0.20 25 / 0.5)'
                    : 'none',
              }}
            />
          )}
        </div>
      ) : null}

      <div className="flex-1 min-w-0 space-y-1.5">
        <div className="flex items-baseline gap-2">
          {show('monitored') && (
            monitored ? (
              <Eye className="h-3.5 w-3.5 text-[color:var(--amber)] shrink-0 self-center" />
            ) : (
              <EyeOff className="h-3.5 w-3.5 text-muted-foreground/60 shrink-0 self-center" />
            )
          )}
          <h3 className="font-display text-[15px] sm:text-[16px] leading-tight truncate group-hover:text-[color:var(--amber)] transition-colors" style={{ letterSpacing: '-0.018em' }}>
            {title}
          </h3>
          {show('year') && (
            <span className="font-mono tabular text-[10px] text-muted-foreground shrink-0">
              {year || '----'}
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-1">
          {show('qualityProfile') && qualityProfile && (
            <span
              className="inline-flex items-center px-1.5 py-0.5 bg-[color:var(--amber-soft)] text-[color:var(--amber)] tracked-caps text-[8.5px]"
              style={{ borderRadius: '3px', letterSpacing: '0.18em' }}
            >
              {qualityProfile}
            </span>
          )}
          {show('network') && network && <StatChip>{network}</StatChip>}
          {show('studio') && studio && <StatChip>{studio}</StatChip>}
          {certification && show('certification') && <StatChip>{certification}</StatChip>}
          {show('rating') && rating !== undefined && rating > 0 && (
            <span className="inline-flex items-center gap-0.5 font-mono tabular text-[10px] text-[color:var(--amber)]">
              <Star className="h-2.5 w-2.5 fill-[color:var(--amber)]" />
              {typeof rating === 'number' ? rating.toFixed(1) : rating}
            </span>
          )}
          {show('episodeProgress') && episodeProgress && (
            <span className="font-mono tabular text-[10px] text-muted-foreground">{episodeProgress}</span>
          )}
          {show('sizeOnDisk') && sizeOnDisk !== undefined && sizeOnDisk > 0 && (
            <span className="font-mono tabular text-[10px] text-muted-foreground/80">{formatBytes(sizeOnDisk)}</span>
          )}
          {show('runtime') && runtime !== undefined && runtime > 0 && (
            <span className="font-mono tabular text-[10px] text-muted-foreground/80">{runtime}m</span>
          )}
          {show('genres') && genres && genres.length > 0 && (
            <span className="text-[10px] text-muted-foreground/80 italic truncate">{genres.slice(0, 3).join(' · ')}</span>
          )}
        </div>

        {show('overview') && overview && (
          <p className="text-[12px] text-muted-foreground/85 leading-snug line-clamp-2">{overview}</p>
        )}
      </div>
    </Link>
  );
}
