'use client';

import Image from 'next/image';
import Link from 'next/link';
import { Check } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { AniListScheduleEntry } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

interface AnimeScheduleCardProps {
  entry: AniListScheduleEntry & { library?: DiscoverLibraryStatus };
  now: number;
}

function formatTime(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function formatFormatLabel(format: string | null): string | null {
  if (!format) return null;
  if (format === 'TV') return 'TV';
  if (format === 'TV_SHORT') return 'Short';
  return format.replace(/_/g, ' ');
}

export function AnimeScheduleCard({ entry, now }: AnimeScheduleCardProps) {
  const { media, episode, airingAt, library } = entry;
  const past = airingAt < now;
  const cover = media.coverImage
    ? toCachedImageSrc(media.coverImage, 'anilist') || media.coverImage
    : null;
  const formatLabel = formatFormatLabel(media.format);
  const studio = media.studios[0] ?? null;
  const inLibrary = library?.exists ?? false;

  return (
    <Link
      href={`/anime/${media.id}`}
      className={`group relative flex gap-3 rounded-lg border border-border/40 bg-card/40 p-2 transition-all hover:border-amber-500/40 hover:bg-card/70 ${
        past ? 'opacity-70 hover:opacity-100' : ''
      }`}
    >
      <div className="relative aspect-[4/5] w-16 sm:w-[72px] shrink-0 overflow-hidden rounded-md bg-muted">
        {cover ? (
          <Image
            src={cover}
            alt={media.title}
            fill
            sizes="80px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized={isProtectedApiImageSrc(cover)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center p-1 text-[10px] text-center text-muted-foreground">
            {media.title}
          </div>
        )}
        {inLibrary && (
          <div
            className="absolute -top-1 -right-1 flex items-center justify-center w-5 h-5 rounded-full bg-emerald-500 text-foreground shadow-md"
            title={`In ${library?.type === 'movie' ? 'Radarr' : 'Sonarr'} library`}
          >
            <Check className="h-3 w-3" strokeWidth={3} />
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-1 flex-col justify-between gap-1 py-0.5">
        <div className="min-w-0">
          <p className="text-[13px] font-semibold leading-tight line-clamp-2 group-hover:text-amber-200 transition-colors">
            {media.title}
          </p>
          {studio && (
            <p className="mt-0.5 text-[10.5px] text-muted-foreground/80 tracked-caps truncate">
              {studio}
            </p>
          )}
        </div>

        <div className="flex flex-col gap-0.5">
          <div className="flex items-baseline gap-1.5 text-[11px]">
            <span className="font-mono tabular-nums text-muted-foreground">
              Ep {episode}
            </span>
            <span className="text-muted-foreground/50">·</span>
            <span
              className={`font-mono tabular-nums ${past ? 'text-muted-foreground' : 'text-amber-300'}`}
            >
              {formatTime(airingAt)}
            </span>
          </div>
          {formatLabel && (
            <span className="inline-flex w-fit items-center rounded-sm border border-border/40 px-1 py-px text-[9px] tracked-caps text-muted-foreground/70">
              {formatLabel}
            </span>
          )}
        </div>
      </div>
    </Link>
  );
}
