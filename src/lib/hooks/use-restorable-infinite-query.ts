'use client';

import { useEffect } from 'react';
import {
  useInfiniteQuery,
  useQueryClient,
  type InfiniteData,
  type QueryClient,
  type UseInfiniteQueryOptions,
} from '@tanstack/react-query';
import { useRouteViewState } from './use-route-view-state';

/** Remember how much of a paginated view the user had opened. QueryClient still
 * owns all payloads. If its cache expired while visiting a detail page, rebuild
 * that extent so scroll restoration is not stranded at page one's bottom. */
function useRestorableQuery(options: UseInfiniteQueryOptions, client?: QueryClient) {
  const query = useInfiniteQuery(options, client);
  const queryClient = useQueryClient(client);
  const data = queryClient.getQueryData<InfiniteData<unknown>>(options.queryKey);
  const count = data?.pages.length ?? 0;
  const [remembered, setRemembered] = useRouteViewState(`pages:${JSON.stringify(options.queryKey)}`, 1);
  const { isFetching, isError, hasNextPage, fetchNextPage } = query;

  useEffect(() => {
    if (options.enabled === false || isError) return;
    if (count > remembered) setRemembered(count);
    else if (count > 0 && count < remembered && hasNextPage && !isFetching) {
      void fetchNextPage();
    }
  }, [count, remembered, setRemembered, options.enabled, isError, hasNextPage, isFetching, fetchNextPage]);
  return query;
}

// Preserve TanStack's overloads, including each caller's select/result types.
export const useRestorableInfiniteQuery = useRestorableQuery as typeof useInfiniteQuery;
