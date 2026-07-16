'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonOk } from '@/lib/http';

interface ScopeOptionsResponse {
  qbitCategories: string[];
  qbitTags: string[];
  trackerDomains: string[];
  sonarrTags: { id: number; label: string }[];
  radarrTags: { id: number; label: string }[];
}

const EMPTY: string[] = [];

/**
 * Live autocomplete sources for the cleanup config tabs: qBittorrent
 * categories, tags, and tracker domains currently present in the client.
 * Failures (qBit unreachable, no torrents) degrade to empty lists — the
 * chip inputs then simply offer no suggestions.
 */
export function useScopeOptions(): {
  categories: string[];
  tags: string[];
  trackerDomains: string[];
} {
  const query = useQuery({
    queryKey: ['cleanup', 'scope-options'],
    queryFn: ({ signal }) =>
      fetch('/api/cleanup/scope-options', { signal }).then(jsonOk<ScopeOptionsResponse>),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
    retry: 1,
  });

  return {
    categories: query.data?.qbitCategories ?? EMPTY,
    tags: query.data?.qbitTags ?? EMPTY,
    trackerDomains: query.data?.trackerDomains ?? EMPTY,
  };
}
