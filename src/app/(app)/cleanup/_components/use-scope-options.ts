'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';

interface ScopeOptionsResponse {
  qbitCategories: string[];
  qbitTags: string[];
  trackerDomains: string[];
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
    // An ApiError carries the status, so the app's retry rule (query-client.ts)
    // retries an outage once and a refusal never.
    queryFn: jsonFetcher<ScopeOptionsResponse>('/api/cleanup/scope-options'),
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  return {
    categories: query.data?.qbitCategories ?? EMPTY,
    tags: query.data?.qbitTags ?? EMPTY,
    trackerDomains: query.data?.trackerDomains ?? EMPTY,
  };
}
