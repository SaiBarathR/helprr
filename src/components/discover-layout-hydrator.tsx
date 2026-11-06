'use client';

import { useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUIStore } from '@/lib/store';
import { validateDiscoverLayout } from '@/lib/discover-layout-config';
import { queryKeys } from '@/lib/query-keys';
import { discoverFetch } from '@/app/(app)/discover/_components/discover-data';

export function DiscoverLayoutHydrator() {
  // Same query as the Discover home (useDiscoverHome), so opening /discover
  // first shares this request instead of sending a second one. Infinity: this
  // observer loads once per app start (the Discover home still refetches on
  // mount); layout saves invalidate the key.
  const { data: validated } = useQuery({
    queryKey: queryKeys.discover('layout'),
    queryFn: ({ signal }) => discoverFetch<unknown>('/api/settings/discover-layout', signal),
    select: validateDiscoverLayout,
    staleTime: Infinity,
    retry: false,
  });
  useEffect(() => {
    if (validated) useUIStore.getState().setDiscoverLayout(validated);
  }, [validated]);
  return null;
}
