'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { WatchHero } from '@/components/jellyfin-streaming/watch-hero';
import { UpcomingRails } from '@/components/jellyfin-streaming/upcoming-rails';
import { RecommendationRails } from '@/components/jellyfin-streaming/recommendation-rails';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * Music libraries get square album art; artists and unreleased titles get
 * portraits; everything watchable is landscape. Mirrors the ViewMode-per-section
 * scheme the reference install runs.
 */
function shapeForCollection(collectionType: string): 'landscape' | 'portrait' | 'square' {
  const type = collectionType.toLowerCase();
  if (type === 'music') return 'square';
  if (type === 'books' || type === 'audiobooks') return 'portrait';
  return 'landscape';
}

export default function WatchHomePage() {
  const { playItem } = useJellyfinPlayback();
  const play = useCallback((item: JellyfinItem) => void playItem(item), [playItem]);
  const query = useQuery({
    queryKey: queryKeys.jellyfinHome(),
    queryFn: jsonFetcher<CatalogHomeResponse>('/api/jellyfin/catalog/home'),
  });
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) {
    return <ErrorState message="Couldn't load your Jellyfin library." onRetry={() => void query.refetch()} />;
  }
  const data = query.data;
  if (!data?.linked) {
    return (
      <div className="p-4">
        <h1 className="sr-only">Watch</h1>
        <WatchTopBar />
        <p className="mt-8 text-sm text-muted-foreground">Link a Jellyfin account to browse and play your library here.</p>
      </div>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="hpr-watch-page-enter pb-28">
        <h1 className="sr-only">Watch</h1>
        <WatchHero items={data.spotlight ?? []} onPlay={play} />

        <div className="space-y-6 py-4 md:py-6">
          <WatchTopBar />

          <CatalogRail shape="landscape" identity="series" title="Continue watching" items={data.resume} onPlay={play} />
          <CatalogRail shape="landscape" identity="series" title="Next up" items={data.nextUp} onPlay={play} />

          {data.latest.map((row) => (
            <CatalogRail
              key={row.libraryId}
              title={`Latest in ${row.libraryName}`}
              href={`/jellyfin/library/v/${row.libraryId}?name=${encodeURIComponent(row.libraryName)}&type=${encodeURIComponent(row.collectionType)}`}
              shape={shapeForCollection(row.collectionType)}
              items={row.items}
              onPlay={play}
            />
          ))}

          <UpcomingRails />

          <RecommendationRails />

          <CatalogRail
            shape="landscape"
            title="Favorites"
            href="/jellyfin/library/favorites"
            items={data.favorites}
            onPlay={play}
          />
        </div>
      </div>
    </>
  );
}
