'use client';

import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import { jellyfinImageUrl } from '@/lib/jellyfin-playback/image';
import type { CatalogHomeResponse } from '@/types/jellyfin-streaming';
import { FadeInImage } from '@/components/media/fade-in-image';

export default function WatchHomePage() {
  const playback = useJellyfinPlayback();
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
        <WatchSubNav />
        <p className="mt-8 text-sm text-muted-foreground">Link a Jellyfin account to browse and play your library here.</p>
      </div>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="space-y-6 p-4 pb-28">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="sr-only">Watch</h1>
          <WatchSubNav />
        </div>

        {data.views.length > 0 && (
          <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-hide">
            {data.views.map((view) => (
              <Link
                key={view.Id}
                href={`/jellyfin/library/v/${view.Id}?name=${encodeURIComponent(view.Name)}&type=${encodeURIComponent(view.CollectionType || '')}`}
                className="relative h-16 w-36 shrink-0 overflow-hidden rounded-lg bg-muted"
              >
                {jellyfinImageUrl(view.Id, 'Primary', 360) && (
                  <FadeInImage src={jellyfinImageUrl(view.Id, 'Primary', 360)!} alt="" fill sizes="144px" unoptimized className="object-cover" />
                )}
                <span className="absolute inset-0 bg-gradient-to-t from-black/70 to-transparent" />
                <span className="absolute bottom-1.5 left-2 text-xs font-medium text-white">{view.Name}</span>
              </Link>
            ))}
          </div>
        )}

        <CatalogRail shape="landscape" title="Continue watching" items={data.resume} onPlay={(item) => void playback.playItem(item)} />
        <CatalogRail shape="landscape" title="Next up" items={data.nextUp} onPlay={(item) => void playback.playItem(item)} />
        <CatalogRail shape="portrait" upcoming title="Upcoming" items={data.upcoming ?? []} />
        {(data.suggestions ?? []).map((row) => (
          <CatalogRail
            key={row.title}
            title={row.title}
            items={row.items}
            onPlay={(item) => void playback.playItem(item)}
          />
        ))}
        {data.latest.map((row) => (
          <CatalogRail
            key={row.libraryId}
            title={`Latest in ${row.libraryName}`}
            href={`/jellyfin/library/v/${row.libraryId}?name=${encodeURIComponent(row.libraryName)}&type=${encodeURIComponent(row.collectionType)}`}
            items={row.items}
            onPlay={(item) => void playback.playItem(item)}
          />
        ))}
        <CatalogRail title="Favorites" href="/jellyfin/library/favorites" items={data.favorites} onPlay={(item) => void playback.playItem(item)} />
      </div>
    </>
  );
}
