'use client';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { jsonFetcher } from '@/lib/query-fetch';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';
export function useSeasonEpisodes(seasonId: string | null) {
  const query = useInfiniteQuery({
    queryKey: ['jellyfin', 'catalog', 'episodes-paged', seasonId],
    initialPageParam: 0,
    queryFn: ({ signal, pageParam }) => jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${seasonId}?expand=episodes&episodeLimit=50&episodeStart=${pageParam}`)({ signal }),
    getNextPageParam: (last) => {
      const next = (last.episodesStart ?? 0) + (last.episodes?.length ?? 0);
      return next < (last.episodesTotal ?? 0) && (last.episodes?.length ?? 0) > 0 ? next : undefined;
    },
    enabled: Boolean(seasonId),
  });
  return { ...query, episodes: query.data?.pages.flatMap((page) => page.episodes ?? []) ?? [] };
}
