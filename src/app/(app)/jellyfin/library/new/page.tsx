'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { UpcomingRails } from '@/components/jellyfin-streaming/upcoming-rails';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * New & Popular.
 *
 * The site's equivalent leads with what is coming and what has just landed, so
 * this is the arr calendar's upcoming windows followed by each library's most
 * recent additions — both already available, just never gathered on one page.
 */
export default function WatchNewPage() {
  const playback = useJellyfinPlayback();
  const query = useQuery({
    queryKey: queryKeys.jellyfinHome(),
    queryFn: jsonFetcher<CatalogHomeResponse>('/api/jellyfin/catalog/home'),
  });
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) {
    return <ErrorState message="Couldn't load what's new." onRetry={() => void query.refetch()} />;
  }

  const play = (item: JellyfinItem) => void playback.playItem(item);
  const latest = query.data?.latest ?? [];

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-6 pb-28">
        <h1 className="sr-only">New &amp; Popular</h1>
        <WatchTopBar />

        <UpcomingRails />

        {latest.map((row) => (
          <CatalogRail
            key={row.libraryId}
            shape="landscape"
            title={`New in ${row.libraryName}`}
            href={`/jellyfin/library/v/${row.libraryId}?name=${encodeURIComponent(row.libraryName)}&type=${encodeURIComponent(row.collectionType)}`}
            items={row.items}
            onPlay={play}
          />
        ))}

        <CatalogRail
          shape="landscape"
          title="Popular with you"
          href="/jellyfin/library/favorites"
          items={query.data?.favorites ?? []}
          onPlay={play}
        />
      </div>
    </>
  );
}
