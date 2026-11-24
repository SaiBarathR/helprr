'use client';

import { useQuery } from '@tanstack/react-query';
import { ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';

/**
 * The instance a title page shows: its ?instance=, or the type's default one when
 * the page was opened without it. Actions on per-instance ids (history events,
 * blocklist entries) must name it, never leave the server to guess.
 */
export function useArrInstanceId(
  type: 'SONARR' | 'RADARR',
  instance: string | undefined,
  enabled = true,
): string | undefined {
  const instancesQuery = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; type: string; isDefault: boolean }>>('/api/instances'),
    enabled: enabled && !instance,
    select: ensureArray,
  });
  return instance ?? instancesQuery.data?.find((i) => i.type === type && i.isDefault)?.id;
}
