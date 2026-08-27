'use client';

import { useMemo, useState } from 'react';
import { useQueries, useQuery } from '@tanstack/react-query';
import { ChevronDown } from 'lucide-react';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { WatchHero } from '@/components/jellyfin-streaming/watch-hero';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import type {
  CatalogFiltersResponse,
  CatalogHomeResponse,
  CatalogItemsResponse,
} from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

/** How many genre rails to build. The site shows a comparable handful. */
const GENRE_RAILS = 8;
const RAIL_SIZE = 20;

/**
 * A library presented the way the site presents TV Shows and Movies: a
 * billboard, a Genres selector beside the page title, and rails cut by genre.
 *
 * Deliberately *not* the paginated grid at /v/[libraryId]. That grid is the
 * "show me everything" view and stays reachable through Browse; these two
 * pages are for wandering, which is a different job and a different shape.
 */
export function CollectionHub({
  title,
  collectionType,
  includeItemTypes,
}: {
  title: string;
  /** Jellyfin CollectionType to find the owner's library by. */
  collectionType: string;
  /** What counts as a title here — Series for shows, Movie for films. */
  includeItemTypes: string;
}) {
  const playback = useJellyfinPlayback();
  const [genre, setGenre] = useState<string | null>(null);

  const home = useQuery({
    queryKey: queryKeys.jellyfinHome(),
    queryFn: jsonFetcher<CatalogHomeResponse>('/api/jellyfin/catalog/home'),
  });

  const library = useMemo(
    () => (home.data?.views ?? []).find(
      (view) => (view.CollectionType || '').toLowerCase() === collectionType,
    ),
    [home.data?.views, collectionType],
  );
  const parentId = library?.Id;

  const filters = useQuery({
    queryKey: ['jellyfin', 'catalog', 'filters', parentId],
    queryFn: jsonFetcher<CatalogFiltersResponse>(`/api/jellyfin/catalog/filters?parentId=${parentId}`),
    enabled: Boolean(parentId),
    staleTime: 30 * 60_000,
  });

  const spotlight = useQuery({
    queryKey: ['jellyfin', 'catalog', 'hub-spotlight', parentId, includeItemTypes],
    queryFn: jsonFetcher<CatalogItemsResponse>(
      `/api/jellyfin/catalog/items?parentId=${parentId}&includeItemTypes=${includeItemTypes}&recursive=true&sortBy=Random&limit=24`,
    ),
    enabled: Boolean(parentId),
    staleTime: 10 * 60_000,
  });

  // Memoised so the fallback array is not a fresh identity every render, which
  // would re-key the rail queries below on each pass.
  const genres = useMemo(() => filters.data?.genres ?? [], [filters.data?.genres]);
  const railGenres = useMemo(
    () => (genre ? [genre] : genres.slice(0, GENRE_RAILS)),
    [genre, genres],
  );

  const rails = useQueries({
    queries: railGenres.map((name) => ({
      queryKey: ['jellyfin', 'catalog', 'hub-rail', parentId, includeItemTypes, name],
      queryFn: jsonFetcher<CatalogItemsResponse>(
        `/api/jellyfin/catalog/items?parentId=${parentId}&includeItemTypes=${includeItemTypes}`
        + `&recursive=true&genres=${encodeURIComponent(name)}&sortBy=CommunityRating&sortOrder=Descending&limit=${RAIL_SIZE}`,
      ),
      enabled: Boolean(parentId),
      staleTime: 10 * 60_000,
    })),
  });

  if (home.isPending && !home.data) return <PageSpinner />;
  if (home.isError) {
    return <ErrorState message={`Couldn't load ${title}.`} onRetry={() => void home.refetch()} />;
  }
  if (!library) {
    return <p className="py-8 text-sm text-muted-foreground">No {title} library on this Jellyfin server.</p>;
  }

  const play = (item: JellyfinItem) => void playback.playItem(item);
  // The billboard wants artwork it can actually fill a wide frame with.
  const heroItems = (spotlight.data?.items ?? [])
    .filter((item) => (item.BackdropImageTags?.length ?? 0) > 0 && Boolean(item.Overview))
    .slice(0, 1);

  return (
    <div className="pb-28">
      <h1 className="sr-only">{title}</h1>

      <WatchHero items={heroItems} onPlay={play} />

      <div className="mb-4 flex items-center gap-4">
        <h2 className="text-2xl font-medium tracking-tight md:text-3xl">{title}</h2>
        {genres.length > 0 && (
          <DropdownMenu>
            <DropdownMenuTrigger className="inline-flex items-center gap-2 border border-white/40 bg-black/40 px-3 py-1.5 text-sm text-white transition-colors hover:border-white">
              {genre ?? 'Genres'}
              <ChevronDown className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
              <DropdownMenuItem onSelect={() => setGenre(null)}>All genres</DropdownMenuItem>
              {genres.map((name) => (
                <DropdownMenuItem key={name} onSelect={() => setGenre(name)}>
                  {name}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      <div className="space-y-6">
        {railGenres.map((name, index) => {
          const items = rails[index]?.data?.items ?? [];
          if (items.length === 0) return null;
          return (
            <CatalogRail
              key={name}
              shape="landscape"
              title={name}
              items={items}
              onPlay={play}
              href={`/jellyfin/library/v/${library.Id}?name=${encodeURIComponent(library.Name)}&type=${encodeURIComponent(library.CollectionType || collectionType)}`}
            />
          );
        })}

        {rails.every((rail) => (rail.data?.items?.length ?? 0) === 0) && !rails.some((rail) => rail.isPending) && (
          <p className="text-sm text-muted-foreground">Nothing to show here yet.</p>
        )}
      </div>
    </div>
  );
}
