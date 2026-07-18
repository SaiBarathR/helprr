'use client';

import Link from 'next/link';
import { Star, Film, Tv, Check, ExternalLink, Plus } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import type { DiscoverItem } from '@/types';
import { FadeInImage } from '@/components/media/fade-in-image';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import { useCan } from '@/components/permission-provider';

interface DiscoverMediaRailProps {
  title: string;
  items: DiscoverItem[];
}

export function DiscoverMediaRail({ title, items }: DiscoverMediaRailProps) {
  const canAddMovies = useCan('movies.add');
  const canAddSeries = useCan('series.add');
  if (!items.length) return null;

  return (
    <div>
      <h2 className="text-base font-semibold mb-2">{title}</h2>
      <div className="flex gap-2.5 overflow-x-auto pb-1 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide animate-rail-in">
        {items.map((item, i) => {
          const posterSrc = item.posterPath
            ? toCachedImageSrc(item.posterPath, 'tmdb') || item.posterPath
            : null;
          const href = `/discover/${item.mediaType === 'movie' ? 'movie' : 'tv'}/${item.tmdbId}`;
          const libraryInstance = item.library?.instances?.[0]
            ?? (item.library?.id ? {
              id: item.library.id,
              instanceId: item.library.instanceId ?? '',
            } : null);
          const libraryHref = libraryInstance
            ? `/${item.mediaType === 'movie' ? 'movies' : 'series'}/${libraryInstance.id}${libraryInstance.instanceId ? `?instance=${libraryInstance.instanceId}` : ''}`
            : null;
          const canAdd = item.mediaType === 'movie' ? canAddMovies : canAddSeries;
          const params = new URLSearchParams({ term: item.title, tmdbId: String(item.tmdbId) });
          if (item.mediaType !== 'movie') params.set('seriesType', 'standard');
          const addHref = `/${item.mediaType === 'movie' ? 'movies' : 'series'}/add?${params.toString()}`;
          return (
            <QuickContextMenu
              key={`${item.mediaType}-${item.tmdbId}`}
              label={`${item.title} actions`}
              actions={[
                { id: 'open', label: 'Open details', icon: <ExternalLink />, href },
                ...(libraryHref ? [{
                  id: 'library',
                  label: 'Open in library',
                  icon: <Check />,
                  href: libraryHref,
                }] : canAdd ? [{
                  id: 'add',
                  label: `Add to ${item.mediaType === 'movie' ? 'Radarr' : 'Sonarr'}`,
                  icon: <Plus />,
                  href: addHref,
                }] : []),
              ]}
            >
              <Link
                href={href}
                className="group relative min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px] 2xl:min-w-[196px] 2xl:w-[196px] text-left shrink-0"
              >
                <div className="relative aspect-[2/3] rounded-xl overflow-hidden bg-muted/60 border border-border/40">
                {posterSrc ? (
                  <FadeInImage
                    src={posterSrc}
                    alt={item.title}
                    fill
                    sizes="(max-width: 640px) 35vw, (max-width: 768px) 140px, (max-width: 1024px) 150px, (max-width: 1280px) 164px, (max-width: 1536px) 180px, 196px"
                    priority={i < 4}
                    className="object-cover transition-transform duration-300 group-hover:scale-105"
                    unoptimized={isProtectedApiImageSrc(posterSrc)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    {item.mediaType === 'movie' ? <Film className="h-7 w-7" /> : <Tv className="h-7 w-7" />}
                  </div>
                )}
                <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/20 to-transparent" />
                <div className="absolute top-1.5 left-1.5 flex items-center justify-center h-5 w-5 rounded-md bg-black/55">
                  {item.mediaType === 'movie'
                    ? <Film className="h-3 w-3 text-blue-400" />
                    : <Tv className="h-3 w-3 text-violet-400" />}
                </div>
                {item.library?.exists && (
                  <div className="absolute top-1.5 right-1.5 flex items-center justify-center h-5 w-5 rounded-md bg-black/55 backdrop-blur-md">
                    <Check className="h-3 w-3 text-green-400" strokeWidth={3} />
                  </div>
                )}
                <div className="absolute bottom-0 left-0 right-0 p-2">
                  <p className="text-xs text-white font-medium line-clamp-2 leading-tight">{item.title}</p>
                  <div className="mt-1 flex items-center justify-between text-[10px] text-white/80">
                    <span>{item.year ?? '----'}</span>
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                      {item.rating.toFixed(1)}
                    </span>
                  </div>
                </div>
                </div>
              </Link>
            </QuickContextMenu>
          );
        })}
      </div>
    </div>
  );
}
