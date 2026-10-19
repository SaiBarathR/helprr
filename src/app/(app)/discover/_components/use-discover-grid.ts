import { useCallback, useMemo } from 'react';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { queryKeys } from '@/lib/query-keys';
import type { DiscoverFiltersState } from '@/lib/store';
import type { DiscoverItem, DiscoverResponse } from '@/types';
import type { DiscoverView } from './link-view';
import { discoverFetch } from './discover-data';

/** The browse/search grid for the view on screen: its infinite query and its items, without repeats. */
export function useDiscoverGrid({
  query,
  discoverContentType,
  discoverSort,
  discoverSortDirection,
  discoverFilters,
  activeSectionKey,
  personFilter,
  gridMode,
}: {
  query: string;
  discoverContentType: DiscoverView['contentType'];
  discoverSort: string;
  discoverSortDirection: DiscoverView['sortDirection'];
  discoverFilters: DiscoverFiltersState;
  activeSectionKey: string | null;
  personFilter: DiscoverView['person'];
  gridMode: boolean;
}) {
  const buildQueryString = useCallback((pageValue: number) => {
    const params = new URLSearchParams();
    const mode = query.trim() ? 'search' : 'browse';
    params.set('mode', mode);
    params.set('page', String(pageValue));
    params.set('contentType', discoverContentType);
    params.set('sortBy', discoverSort);
    params.set('sortOrder', discoverSortDirection);
    if (query.trim()) params.set('q', query.trim());
    if (activeSectionKey) params.set('section', activeSectionKey);

    if (discoverFilters.genres.length) params.set('genres', discoverFilters.genres.join(','));
    if (discoverFilters.yearFrom) params.set('yearFrom', discoverFilters.yearFrom);
    if (discoverFilters.yearTo) params.set('yearTo', discoverFilters.yearTo);
    if (discoverFilters.runtimeMin) params.set('runtimeMin', discoverFilters.runtimeMin);
    if (discoverFilters.runtimeMax) params.set('runtimeMax', discoverFilters.runtimeMax);
    if (discoverFilters.language) params.set('language', discoverFilters.language);
    if (discoverFilters.region) params.set('region', discoverFilters.region);
    if (discoverFilters.ratingMin) params.set('ratingMin', discoverFilters.ratingMin);
    if (discoverFilters.ratingMax) params.set('ratingMax', discoverFilters.ratingMax);
    if (discoverFilters.voteCountMin) params.set('voteCountMin', discoverFilters.voteCountMin);
    if (discoverFilters.providers.length) params.set('providers', discoverFilters.providers.join(','));
    if (discoverFilters.networks.length) params.set('networks', discoverFilters.networks.join(','));
    if (discoverFilters.companies.length) params.set('companies', discoverFilters.companies.join(','));
    if (discoverFilters.releaseState) params.set('releaseState', discoverFilters.releaseState);
    if (personFilter) {
      params.set('with_people', String(personFilter.id));
    }

    return params.toString();
  }, [
    query,
    discoverContentType,
    discoverSort,
    discoverSortDirection,
    discoverFilters,
    activeSectionKey,
    personFilter,
  ]);

  // Browse/search grid. The query key carries the full browse state, so the
  // cache + staleTime replace the manual abort + page/totalPages tracking; gcTime
  // gives instant back-nav paint. The query `signal` handles abort (the old
  // gridFetchControllerRef/loadMoreControllerRef are gone).
  const gridQuery = useInfiniteQuery({
    queryKey: queryKeys.discover('grid', {
      query: query.trim(),
      contentType: discoverContentType,
      sort: discoverSort,
      sortDirection: discoverSortDirection,
      filters: discoverFilters,
      activeSectionKey,
      personId: personFilter?.id ?? null,
    }),
    queryFn: ({ pageParam, signal }) =>
      discoverFetch<DiscoverResponse>(`/api/discover?${buildQueryString(pageParam)}`, signal),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      (last.page ?? 1) < (last.totalPages ?? 1) ? (last.page ?? 1) + 1 : undefined,
    enabled: gridMode,
    staleTime: 60_000,
    retry: false,
  });


  // Dedup in the flatten: useInfiniteQuery re-runs every page on refetch, so
  // per-append de-dup isn't enough — collapse the full list by mediaType-tmdbId.
  const items = useMemo<DiscoverItem[]>(() => {
    const seen = new Set<string>();
    const flat: DiscoverItem[] = [];
    for (const p of gridQuery.data?.pages ?? []) {
      for (const item of p.items ?? []) {
        const key = `${item.mediaType}-${item.tmdbId}`;
        if (seen.has(key)) continue;
        seen.add(key);
        flat.push(item);
      }
    }
    return flat;
  }, [gridQuery.data]);

  return { gridQuery, items };
}
