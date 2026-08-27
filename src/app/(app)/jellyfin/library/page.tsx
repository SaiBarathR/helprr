'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { WatchSubNav } from '@/components/jellyfin-streaming/watch-subnav';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { WatchHero } from '@/components/jellyfin-streaming/watch-hero';
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

/** "Today", "1 day", "2 weeks" — the countdown the reference shows on upcoming cards. */
function upcomingSubtitle(item: JellyfinItem): string | undefined {
  const raw = item.PremiereDate ?? item.StartDate;
  if (!raw) return undefined;
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return undefined;
  const days = Math.ceil((date.getTime() - Date.now()) / 86_400_000);
  const when = days <= 0 ? 'Today' : days === 1 ? '1 day' : days < 30 ? `${days} days` : `${Math.round(days / 30)} months`;
  return `${when} · ${date.toLocaleDateString()}`;
}

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
        <h1 className="sr-only">Watch</h1>
        <WatchSubNav />
        <p className="mt-8 text-sm text-muted-foreground">Link a Jellyfin account to browse and play your library here.</p>
      </div>
    );
  }

  const play = (item: JellyfinItem) => void playback.playItem(item);

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      <div className="pb-28">
        <h1 className="sr-only">Watch</h1>
        <WatchHero items={data.spotlight ?? []} onPlay={play} />

        <div className="space-y-6 p-4 md:p-6">
          <WatchSubNav />

          <CatalogRail shape="landscape" title="Continue watching" items={data.resume} onPlay={play} />
          <CatalogRail shape="landscape" title="Next up" items={data.nextUp} onPlay={play} />

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

          <CatalogRail
            shape="portrait"
            upcoming
            title="Upcoming"
            items={data.upcoming ?? []}
            subtitleFor={upcomingSubtitle}
          />

          {(data.suggestions ?? []).map((row) => (
            <CatalogRail key={row.title} shape="landscape" title={row.title} items={row.items} onPlay={play} />
          ))}

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
