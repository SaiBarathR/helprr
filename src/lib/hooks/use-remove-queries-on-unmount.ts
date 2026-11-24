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
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      for (const queryKey of keys.current) queryClient.removeQueries({ queryKey });
      keys.current = [];
    };
  }, [queryClient]);
  // A delete that finishes after the user has already left removes at once.
  return useCallback((...more: QueryKey[]) => {
    if (mounted.current) keys.current.push(...more);
    else for (const queryKey of more) queryClient.removeQueries({ queryKey });
  }, [queryClient]);
}
