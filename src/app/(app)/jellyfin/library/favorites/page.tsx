'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogPosterCard } from '@/components/jellyfin-streaming/poster-card';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import type { CatalogItemsResponse } from '@/types/jellyfin-streaming';

export default function FavoritesPage() {
  const playback = useJellyfinPlayback();
  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'favorites'],
    queryFn: jsonFetcher<CatalogItemsResponse>('/api/jellyfin/catalog/items?filters=IsFavorite&recursive=true&sortBy=SortName&limit=100'),
  });

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) return <ErrorState message="Couldn't load favorites." onRetry={() => void query.refetch()} />;

  return (
    <div className="space-y-4 p-4 pb-28">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold tracking-tight">Favorites</h1>
        <WatchSubNav />
      </div>
      <div className="flex flex-wrap gap-3">
        {(query.data?.items ?? []).map((item) => (
          <CatalogPosterCard key={item.Id} item={item} onPlay={(next) => void playback.playItem(next)} />
        ))}
      </div>
    </div>
  );
}
