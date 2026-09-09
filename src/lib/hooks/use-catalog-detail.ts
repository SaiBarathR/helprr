'use client';
import { useSeasonEpisodes } from '@/lib/hooks/use-season-episodes';
import { useQueries, useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import type { CatalogItemDetailResponse } from '@/types/jellyfin-streaming';

export function useCatalogDetail(itemId: string | null) {
  const core = useQuery({ queryKey: queryKeys.jellyfinItem(itemId ?? '', 'core'),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${itemId}?expand=`), enabled: Boolean(itemId) });
  const type = core.data?.item?.Type;
  const expansions = type === 'Series' || type === 'Season' || type === 'Episode'
    ? ['seasons', 'similar,trailers']
    : ['similar,trailers,specials', 'children,filmography,instantMix,theme'];
  const details = useQueries({ queries: expansions.map((expand) => ({
    queryKey: queryKeys.jellyfinItem(itemId ?? '', expand),
    queryFn: jsonFetcher<CatalogItemDetailResponse>(`/api/jellyfin/catalog/items/${itemId}?expand=${expand}`), enabled: Boolean(core.data?.item),
  })) });
  const merged = core.data ? Object.assign({}, core.data, ...details.map((query) => query.data ?? {})) as CatalogItemDetailResponse : undefined;
  const seasonId = type === 'Season' ? itemId : type === 'Episode' ? (core.data?.item?.SeasonId ?? null) : type === 'Series' ? (merged?.seasons?.[0]?.Id ?? null) : null;
  const episodes = useSeasonEpisodes(seasonId);
  return { ...core,
    episodesMore: episodes.hasNextPage,
    episodesLoading: episodes.isFetchingNextPage,
    loadMoreEpisodes: () => episodes.fetchNextPage(),
    data: merged ? { ...merged, episodes: episodes.episodes } : undefined,
    optionalFailed: details.some((query) => query.isError || Boolean(query.data?.failedExpansions?.length)) || episodes.isError,
    refetch: async () => { await Promise.all([core.refetch(), episodes.refetch(), ...details.map((query) => query.refetch())]); },
  };
}
