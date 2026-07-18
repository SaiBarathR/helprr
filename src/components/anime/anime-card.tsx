'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { FadeInImage } from '@/components/media/fade-in-image';
import { WatchlistButton } from '@/components/watchlist/watchlist-button';
import {
  ScheduledAlertButton,
} from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { useAnilistContextMenu } from '@/components/anime/anilist-context-menu';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { Check, ChevronRight, Plus, Star } from 'lucide-react';
import { buildRadarrAddParams, buildSonarrAddParams, isMovieFormat } from '@/lib/anilist-helpers';
import { hasCapability, useMe } from '@/components/permission-provider';
import type { AniListListItem } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

export type AnimeItemWithLibrary = AniListListItem & { library?: DiscoverLibraryStatus };

export function AnimeCard({
  item,
  grid,
  imagePriority,
  onNavigate,
}: {
  item: AnimeItemWithLibrary;
  grid?: boolean;
  imagePriority?: boolean;
  onNavigate?: () => void;
}) {
  const router = useRouter();
  const me = useMe();
  const { buildAnilistContextAction, drawerNode } = useAnilistContextMenu();
  const imgSrc = item.coverImage
    ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
    : null;
  const href = `/anime/${item.id}`;
  const libraryHref = item.library?.exists && item.library.id != null
    ? `${item.library.type === 'movie' ? '/movies' : '/series'}/${item.library.id}${item.library.instanceId ? `?instance=${item.library.instanceId}` : ''}`
    : null;
  const isMovie = isMovieFormat(item.format);
  const addService = isMovie ? 'Radarr' : 'Sonarr';
  const canAdd = !item.library?.exists && hasCapability(me, isMovie ? 'movies.add' : 'series.add');
  const canWatchlist = !item.library?.exists && hasCapability(me, 'watchlist.edit');
  const canSchedule = !item.library?.exists && hasCapability(me, 'scheduledAlerts.edit');
  const addHref = isMovie
    ? `/movies/add?${buildRadarrAddParams({ title: item.title, tmdbId: null })}`
    : `/series/add?${buildSonarrAddParams({ title: item.title, tvdbId: null })}`;
  const watchlistDraft = {
    source: 'ANILIST' as const,
    externalId: String(item.id),
    mediaType: 'anime' as const,
    title: item.title,
    year: item.year ?? item.seasonYear ?? null,
    posterUrl: item.coverImage ?? null,
    overview: null,
    rating: item.averageScore ?? null,
    releaseDate: null,
  };
  const scheduleDraft = {
    source: 'ANILIST' as const,
    externalId: String(item.id),
    mediaType: 'anime' as const,
    title: item.title,
    year: item.year ?? item.seasonYear ?? null,
    posterUrl: item.coverImage,
    href,
  };
  const anilistAction = buildAnilistContextAction({
    mediaId: item.id,
    mediaTitle: item.title,
    mediaType: 'ANIME',
    totalEpisodes: item.episodes,
  });
  const contextGroups: ContextActionGroup[] = [
    {
      id: 'navigation',
      actions: [
        {
          id: 'open-details',
          label: 'Open details',
          icon: <ChevronRight className="h-4 w-4" />,
          onSelect: () => {
            onNavigate?.();
            router.push(href);
          },
        },
        ...(libraryHref ? [{ id: 'open-library', label: 'Open in library', icon: <Check className="h-4 w-4" />, href: libraryHref }] : []),
        ...(canAdd ? [{ id: 'add-library', label: `Add to ${addService}`, icon: <Plus className="h-4 w-4" />, href: addHref }] : []),
      ],
    },
    ...(anilistAction ? [{ id: 'anilist', actions: [anilistAction] }] : []),
  ];

  return (
    <div className={`${grid ? '' : 'flex-shrink-0 w-[110px]'} group relative`}>
      <QuickContextMenu label={`${item.title} actions`} groups={contextGroups}>
      <Link
        href={href}
        className="block"
        onClick={onNavigate}
      >
        <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-sm group-hover:shadow-md transition-shadow">
          {imgSrc ? (
            <FadeInImage
              src={imgSrc}
              alt={item.title}
              fill
              sizes={grid ? '(max-width: 640px) 33vw, (max-width: 768px) 25vw, 16vw' : '110px'}
              priority={imagePriority}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(imgSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
              {item.title}
            </div>
          )}
          {/* Bottom gradient for readability */}
          <div className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-t from-black/60 to-transparent pointer-events-none" />
          {item.averageScore != null && item.averageScore > 0 && (
            <Badge className="absolute top-1 right-1 text-[9px] bg-black/55 text-white gap-0.5">
              <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
              {item.averageScore}%
            </Badge>
          )}
          {item.library?.exists && (
            <Badge className="absolute top-1 left-1 text-[9px] bg-black/55 backdrop-blur-md text-green-400">
              <Check className="h-2 w-2" strokeWidth={3} />
            </Badge>
          )}
          {item.format && (
            <Badge className="absolute bottom-1 left-1 text-[9px] bg-black/55 text-white">
              {item.format.replace(/_/g, ' ')}
            </Badge>
          )}
        </div>
        <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
        <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
          {item.year && <span>{item.year}</span>}
          {item.episodes != null && (
            <>
              {item.year && <span>·</span>}
              <span>{item.episodes} eps</span>
            </>
          )}
        </div>
      </Link>
      </QuickContextMenu>
      {!item.library?.exists && (
        <div className="absolute top-1 left-1 z-10 flex items-center gap-1">
          {canWatchlist && (
            <WatchlistButton
              draft={watchlistDraft}
              variant="icon"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-black/55 backdrop-blur-md text-white hover:bg-black/70"
            />
          )}
          {canSchedule && (
          <ScheduledAlertButton
            draft={scheduleDraft}
            variant="icon"
            className="h-5 w-5"
          />
          )}
        </div>
      )}
      {drawerNode}
    </div>
  );
}
