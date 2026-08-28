'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { CATALOG_GRID_CLASS, CATALOG_WRAP_CLASS } from '@/components/jellyfin-streaming/card-shared';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { cn } from '@/lib/utils';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';

export default function FavoritesPage() {
  const playback = useJellyfinPlayback();
  const cinematic = useWatchSkin() === 'cinematic';
  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'favorites'],
    queryFn: jsonFetcher<CatalogItemsResponse>('/api/jellyfin/catalog/items?filters=IsFavorite&recursive=true&sortBy=SortName&limit=100'),
  });

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load favorites." onRetry={() => void query.refetch()} />;

  return (
    // No py-4 on a phone in cinematic: the masthead directly above already
    // separates itself from the content, and the row that used to sit here
    // holds nothing in this skin — between them they left 32px of empty page
    // above the first poster.
    <div className={cn('pb-28', cinematic ? 'pt-2 md:pt-4' : 'py-4')}>
      <h1 className="sr-only">Favorites</h1>
      {/* Classic's back button and sub-nav, carrying its own gap. Cinematic
          renders nothing at all here — its masthead lives in the Watch layout —
          so `space-y-4` on the wrapper was spending 16px on a row that does not
          exist. */}
      <WatchTopBar className="mb-4" />
      <div className={cinematic ? CATALOG_GRID_CLASS : CATALOG_WRAP_CLASS}>
        {(query.data?.items ?? []).map((item, index) => (
          <CatalogPosterCard
            key={item.Id}
            item={item}
            // A wrapped grid, not a rail: the hover popover would grow over its
            // neighbours and clip at the page edge.
            flat={cinematic}
            className={cinematic ? 'w-full' : undefined}
            priority={index < 6}
            onPlay={(next) => void playback.playItem(next)}
          />
        ))}
      </div>
    </div>
  );
}
