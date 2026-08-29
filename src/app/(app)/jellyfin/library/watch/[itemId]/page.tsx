'use client';

import { use, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { useJellyfinPlayback } from '@/components/jellyfin-streaming/playback-provider';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';

export default function WatchPage({ params }: { params: Promise<{ itemId: string }> }) {
  const { itemId } = use(params);
  const playback = useJellyfinPlayback();
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
  if (query.isError || !query.data?.item) {
    return <ErrorState message="Couldn't start playback." onRetry={() => void query.refetch()} />;
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
