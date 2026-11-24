'use client';

import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';

/**
 * Drops cache entries once the page using them is gone. A delete page removed
 * its title's queries while still on screen, and its own observers fetched them
 * again at once: a 404 for the title just deleted. Removed on unmount instead,
 * so a later visit to that URL still doesn't show the deleted title.
 */
export function useRemoveQueriesOnUnmount(): (...keys: QueryKey[]) => void {
  const queryClient = useQueryClient();
  const keys = useRef<QueryKey[]>([]);
  useEffect(() => () => {
    for (const queryKey of keys.current) queryClient.removeQueries({ queryKey });
    keys.current = [];
  }, [queryClient]);
  return useCallback((...more: QueryKey[]) => { keys.current.push(...more); }, []);
}
