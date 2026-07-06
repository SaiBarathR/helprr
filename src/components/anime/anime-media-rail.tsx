'use client';

import { useState } from 'react';
import Link from 'next/link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Badge } from '@/components/ui/badge';
import { WatchlistAddDialog } from '@/components/watchlist/watchlist-add-dialog';
import { ScheduledAlertDialog } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Bell, Bookmark, Check, ChevronRight, MoreVertical, Plus, Star } from 'lucide-react';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { buildRadarrAddParams, buildSonarrAddParams, isMovieFormat } from '@/lib/anilist-helpers';
import { useMe, hasCapability } from '@/components/permission-provider';
import { useWatchLookup } from '@/components/jellyfin/watch-status-provider';
import { PosterWatchOverlay } from '@/components/jellyfin/watch-status-indicator';
import type { AniListMediaFormat, AniListMediaType } from '@/types/anilist';
import type { DiscoverLibraryStatus } from '@/types';

interface MediaItem {
  id: number;
  title: string;
  coverImage: string | null;
  format?: AniListMediaFormat | null;
  averageScore?: number | null;
  episodes?: number | null;
  seasonYear?: number | null;
  type?: AniListMediaType | null;
  chapters?: number | null;
  volumes?: number | null;
  library?: DiscoverLibraryStatus;
}

interface AnimeMediaRailProps {
  title: string;
  items: MediaItem[];
  viewAllHref?: string;
}

function RailCard({ item, priority }: { item: MediaItem; priority: boolean }) {
  const me = useMe();
  const lookup = useWatchLookup();
  const [watchlistOpen, setWatchlistOpen] = useState(false);
  const [scheduleOpen, setScheduleOpen] = useState(false);

  // `library` is the server-annotated arr membership (Jellyfin-free, covers
  // movies and not-yet-downloaded series). The watch-status hit still matters
  // for surfaces whose data source isn't annotated (e.g. manga-detail
  // recommendations) — a hit is never a false positive.
  const watchStatus = lookup({ anilistId: item.id });
  const inLibrary = item.library?.exists === true || watchStatus != null;
  // Deep-link to the in-app detail of the library copy; ?instance= because arr
  // ids are only unique per instance (same scheme as OpenInInstances).
  const libraryHref = item.library?.exists && item.library.id != null
    ? `${item.library.type === 'movie' ? '/movies' : '/series'}/${item.library.id}${item.library.instanceId ? `?instance=${item.library.instanceId}` : ''}`
    : null;

  const imgSrc = item.coverImage
    ? toCachedImageSrc(item.coverImage, 'anilist') || item.coverImage
    : null;

  const isManga = item.type === 'MANGA' || item.format === 'MANGA' || item.chapters != null || item.volumes != null;
  const href = isManga ? `/anime/manga/${item.id}` : `/anime/${item.id}`;
  const metadata: string[] = [];

  if (item.format) metadata.push(item.format.replace('_', ' '));

  if (isManga) {
    if (item.chapters != null) metadata.push(`${item.chapters} ch`);
    if (item.volumes != null) metadata.push(`${item.volumes} vol`);
  } else if (item.episodes != null) {
    metadata.push(`${item.episodes} eps`);
  }

  // Actions (add / watchlist / schedule) only apply to anime, not manga.
  const showActions = !isManga;
  // Add-to-library mirrors the detail page button: a title-search hand-off to the
  // add page (list items carry no tvdb/tmdb id for an exact pre-match).
  const isMovie = isMovieFormat(item.format ?? null);
  const addService = isMovie ? 'Radarr' : 'Sonarr';
  const canAdd = showActions && !inLibrary && hasCapability(me, isMovie ? 'movies.add' : 'series.add');
  const addHref = isMovie
    ? `/movies/add?${buildRadarrAddParams({ title: item.title, tmdbId: null })}`
    : `/series/add?${buildSonarrAddParams({ title: item.title, tvdbId: null })}`;

  const iconClass =
    'inline-flex h-5 w-5 items-center justify-center rounded-md bg-background/60 backdrop-blur-md text-foreground hover:bg-background/80 transition-colors';

  return (
    <div className="relative shrink-0 min-w-[110px] w-[110px] sm:min-w-[140px] sm:w-[140px] md:min-w-[150px] md:w-[150px] lg:min-w-[164px] lg:w-[164px] xl:min-w-[180px] xl:w-[180px] 2xl:min-w-[196px] 2xl:w-[196px] group snap-start">
      {/* Desktop: individual icons overlaid on the poster's top-right. */}
      {showActions && (
        <div className="absolute top-1 right-1 z-10 hidden md:flex items-center gap-1.5">
          {canAdd && (
            <Link href={addHref} aria-label={`Add to ${addService}`} className={iconClass}>
              <Plus className="h-3.5 w-3.5" />
            </Link>
          )}
          {libraryHref && (
            <Link
              href={libraryHref}
              aria-label="Open in library"
              className="inline-flex h-5 w-5 items-center justify-center rounded-md bg-background/60 backdrop-blur-md text-green-400 hover:bg-background/80 transition-colors"
            >
              <Check className="h-3 w-3" strokeWidth={3} />
            </Link>
          )}
          <button
            type="button"
            aria-label="Add to watchlist"
            onClick={() => setWatchlistOpen(true)}
            className={iconClass}
          >
            <Bookmark className="h-3 w-3" />
          </button>
          <button
            type="button"
            aria-label="Schedule alert"
            onClick={() => setScheduleOpen(true)}
            className={iconClass}
          >
            <Bell className="h-3 w-3" />
          </button>
        </div>
      )}
      <Link href={href} className="block">
        <div className="relative aspect-2/3 rounded-lg overflow-hidden bg-muted border border-border/30 group-hover:border-primary/40 transition-colors">
          {imgSrc ? (
            <FadeInImage
              src={imgSrc}
              alt={item.title}
              fill
              sizes="(max-width: 640px) 35vw, (max-width: 768px) 140px, (max-width: 1024px) 150px, (max-width: 1280px) 164px, (max-width: 1536px) 180px, 196px"
              priority={priority}
              className="object-cover transition-transform duration-300 group-hover:scale-105"
              unoptimized={isProtectedApiImageSrc(imgSrc)}
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-xs p-2 text-center">
              {item.title}
            </div>
          )}
          {item.averageScore != null && item.averageScore > 0 && (
            <Badge className="absolute bottom-1 right-1 text-[9px] bg-background/60 text-foreground gap-0.5">
              <Star className="h-2 w-2 fill-yellow-400 text-yellow-400" />
              {item.averageScore}%
            </Badge>
          )}
          <PosterWatchOverlay status={watchStatus} />
        </div>
        <p className="mt-1 text-xs font-medium leading-tight line-clamp-2">{item.title}</p>
      </Link>
      {/* Footer row: format/episode label + (mobile) the compact actions menu.
          Kept OUTSIDE the Link so tapping the menu never navigates. */}
      <div className="flex items-center justify-between gap-1 text-[11px] text-muted-foreground">
        <span className="truncate">{metadata.join(' · ')}</span>
        {showActions && (
          <div className="md:hidden shrink-0 -my-1">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label="Item actions"
                  className="inline-flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
                >
                  <MoreVertical className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                {canAdd && (
                  <DropdownMenuItem asChild>
                    <Link href={addHref}>
                      <Plus className="mr-2 h-4 w-4" />
                      Add to {addService}
                    </Link>
                  </DropdownMenuItem>
                )}
                {libraryHref && (
                  <DropdownMenuItem asChild>
                    <Link href={libraryHref}>
                      <Check className="mr-2 h-4 w-4" />
                      Open in library
                    </Link>
                  </DropdownMenuItem>
                )}
                <DropdownMenuItem onClick={() => setWatchlistOpen(true)}>
                  <Bookmark className="mr-2 h-4 w-4" />
                  Add to watchlist
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setScheduleOpen(true)}>
                  <Bell className="mr-2 h-4 w-4" />
                  Schedule alert
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        )}
      </div>
      {showActions && (
        <>
          <WatchlistAddDialog
            open={watchlistOpen}
            onOpenChange={setWatchlistOpen}
            draft={{
              source: 'ANILIST',
              externalId: String(item.id),
              mediaType: 'anime',
              title: item.title,
              year: item.seasonYear ?? null,
              posterUrl: item.coverImage ?? null,
              overview: null,
              rating: item.averageScore ?? null,
              releaseDate: null,
            }}
          />
          <ScheduledAlertDialog
            open={scheduleOpen}
            onOpenChange={setScheduleOpen}
            draft={{
              source: 'ANILIST',
              externalId: String(item.id),
              mediaType: 'anime',
              title: item.title,
              posterUrl: item.coverImage,
              href: `/anime/${item.id}`,
            }}
          />
        </>
      )}
    </div>
  );
}

export function AnimeMediaRail({ title, items, viewAllHref }: AnimeMediaRailProps) {
  if (!items.length) return null;

  return (
    <div className='px-2'>
      <div className="flex items-center justify-between mb-2">
        <h2 className="text-base font-semibold">{title}</h2>
        {viewAllHref && (
          <Link href={viewAllHref} className="flex items-center gap-0.5 text-xs text-primary hover:underline font-medium">
            View All
            <ChevronRight className="h-3.5 w-3.5" />
          </Link>
        )}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-2 px-2 md:-mx-6 md:px-6 scrollbar-hide snap-x snap-mandatory animate-rail-in">
        {items.map((item, i) => (
          <RailCard key={item.id} item={item} priority={i < 4} />
        ))}
      </div>
    </div>
  );
}
