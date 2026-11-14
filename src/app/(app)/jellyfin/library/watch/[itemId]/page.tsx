'use client';

import { use, useEffect, useRef } from 'react';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { ApiError } from '@/lib/query-fetch';
import { WatchTopBar } from '@/components/jellyfin-streaming/watch-top-bar';
import { JellyfinLinkPrompt } from '@/components/jellyfin-streaming/jellyfin-link-prompt';
import { useJellyfinPlaybackState } from '@/components/jellyfin-streaming/playback-provider';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';

export default function WatchPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const playback = useJellyfinPlaybackState();
  const router = useRouter();
  const startedId = useRef<string | null>(null);
  const query = useQuery({
    queryKey: queryKeys.jellyfinItem(itemId),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${itemId}?expand=segments`),
  });

  useEffect(() => {
    const next = query.data?.item;
    if (!next || startedId.current === next.Id) return;
    startedId.current = next.Id;
    void playback.playItem(next);
    // The player is mounted above the page, so hand the route somewhere real
    // to sit behind it — minimising used to land on a blank dead end.
    router.replace(next.Type === 'TvChannel'
      ? '/jellyfin/library/live'
      : `/jellyfin/library/item/${next.Id}`);
  }, [playback, query.data?.item, router]);

  if (query.isPending && !query.data) return <PageSpinner />;
  // A direct link opened by a member with no Jellyfin account linked: the
  // catalog has nothing to hand the player, so the Connect form goes here.
  // Both states keep the Watch chrome so there is a way back.
  if (query.data?.linked === false) {
    return (
      <div className="p-4">
        <WatchTopBar />
        <JellyfinLinkPrompt />
      </div>
    );
  }
  if (query.isError || !query.data?.item) {
    // A refusal or a missing title won't change on a retry.
    const final = query.error instanceof ApiError && query.error.status >= 400 && query.error.status < 500;
    return (
      <div className="p-4">
        <WatchTopBar />
        <ErrorState message="Couldn't start playback." onRetry={final ? undefined : () => void query.refetch()} retrying={query.isFetching} />
      </div>
    );
  }

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center p-6 text-center">
      <p className="text-lg font-medium">{query.data.item.Name}</p>
      <p className="mt-1 text-sm text-muted-foreground">
        {playback.status === 'loading' ? 'Opening stream…' : 'Playing in the Helprr player.'}
      </p>
    </div>
  );
}
