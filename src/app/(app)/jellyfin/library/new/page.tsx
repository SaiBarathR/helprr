'use client';

import { useCatalogHome } from '@/lib/hooks/use-catalog-home';

import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { CatalogRail } from '@/components/jellyfin-streaming/catalog-rail';
import { UpcomingRails } from '@/components/jellyfin-streaming/upcoming-rails';
import { NewAndHot } from '@/components/jellyfin-streaming/cinematic/new-and-hot';
import { useWatchSkin } from '@/lib/hooks/use-watch-skin';
import { useJellyfinPlaybackState } from '@/components/jellyfin-streaming/playback-provider';
import type { JellyfinItem } from '@/types/jellyfin';

/**
 * New & Popular.
 *
 * The site's equivalent leads with what is coming and what has just landed, so
 * this is the arr calendar's upcoming windows followed by each library's most
 * recent additions — both already available, just never gathered on one page.
 */
export default function WatchNewPage() {
  const playback = useJellyfinPlaybackState();
  const cinematic = useWatchSkin() === 'cinematic';
  const query = useCatalogHome();
  useRefreshAction(query.refetch);

  if (query.isPending && !query.data) return <PageSpinner />;
  if (query.isError) {
    return <ErrorState message="Couldn't load what's new." onRetry={() => void query.refetch()} />;
  }

  const play = (item: JellyfinItem) => void playback.playItem(item);
  const latest = query.data?.latest ?? [];

  // What has just landed and what you keep going back to — the site's
  // "Everyone's Watching" half, kept as rails behind the second tab.
  const watchingRails = (
    <div className="space-y-6">
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
  );

  if (cinematic) {
    return (
      <>
        <PullToRefresh onRefresh={query.refetch} />
      {query.optionalFailed && <p role="status" className="px-4 py-2 text-sm text-muted-foreground">Some shelves are unavailable. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p>}
        <h1 className="sr-only">New &amp; Popular</h1>
        <NewAndHot railsFallback={watchingRails} />
      </>
    );
  }

  return (
    <>
      <PullToRefresh onRefresh={query.refetch} />
      {query.optionalFailed && <p role="status" className="px-4 py-2 text-sm text-muted-foreground">Some shelves are unavailable. <button className="underline" onClick={() => void query.refetch()}>Retry</button></p>}
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
