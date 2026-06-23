'use client';

import { memo } from 'react';
import { Layers, Check, Bookmark } from 'lucide-react';
import type { CollectionSummary } from '@/types';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';
import { FadeInImage } from '@/components/media/fade-in-image';

interface CollectionCardProps {
  collection: CollectionSummary;
  multiInstance?: boolean;
  imagePriority?: boolean;
  onOpen: () => void;
}

export const CollectionCard = memo(function CollectionCard({
  collection,
  multiInstance,
  imagePriority,
  onOpen,
}: CollectionCardProps) {
  const poster = toCachedImageSrc(collection.poster, 'tmdb', { width: 360 });
  const complete = collection.missingMovies === 0;

  return (
    <button type="button" onClick={onOpen} className="group block w-full text-left">
      <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted shadow-sm">
        {poster ? (
          <FadeInImage
            src={poster}
            alt={collection.title}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 25vw, 20vw"
            priority={imagePriority}
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized={isProtectedApiImageSrc(poster)}
          />
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
            <Layers className="h-10 w-10" />
          </div>
        )}

        <div className="absolute inset-0 bg-gradient-to-t from-background/80 via-background/10 to-transparent" />

        {/* Monitored bookmark — top-left */}
        {collection.monitored && (
          <div className="absolute top-1.5 left-1.5">
            <Bookmark className="h-4 w-4 fill-[var(--hpr-amber)] text-[var(--hpr-amber)] drop-shadow" />
          </div>
        )}

        {/* Missing / complete badge — top-right */}
        <div className="absolute top-1.5 right-1.5">
          {complete ? (
            <span className="inline-flex items-center gap-0.5 rounded-full bg-[var(--hpr-green)]/90 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--hpr-ink)] shadow">
              <Check className="h-2.5 w-2.5" />
              Complete
            </span>
          ) : (
            <span className="inline-flex items-center rounded-full bg-[var(--hpr-amber)]/95 px-1.5 py-0.5 text-[9px] font-semibold text-[var(--hpr-ink)] shadow">
              {collection.missingMovies} missing
            </span>
          )}
        </div>

        {/* Title + meta over the gradient */}
        <div className="absolute inset-x-0 bottom-0 p-2">
          <p className="text-xs font-semibold text-foreground leading-tight line-clamp-2">
            {collection.title}
          </p>
          <p className="mt-0.5 text-[10px] text-foreground/70 truncate">
            {collection.movieCount} {collection.movieCount === 1 ? 'film' : 'films'}
            {multiInstance && collection.instanceLabel && (
              <span className={cn('font-medium text-[var(--hpr-amber)]')}> · {collection.instanceLabel}</span>
            )}
          </p>
        </div>
      </div>
    </button>
  );
});
