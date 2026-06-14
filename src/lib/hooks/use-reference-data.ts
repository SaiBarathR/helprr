'use client';

import { useQuery, useQueries } from '@tanstack/react-query';
import { queryKeys, type ArrService } from '@/lib/query-keys';
import { jsonFetcher, ensureArray } from '@/lib/query-fetch';
import type { QualityProfile, RootFolder, Tag, LidarrMetadataProfile } from '@/types';

// Reference data (quality profiles, tags, root folders, metadata profiles)
// changes rarely, so it gets a long staleTime — and because the query key is
// keyed only on (service, instance), the list / detail / edit / add pages all
// share one cached entry instead of each re-fetching it.
const REFERENCE_STALE = 10 * 60_000;

export function useQualityProfiles(service: ArrService, instanceId?: string) {
  return useQuery({
    queryKey: queryKeys.qualityProfiles(service, instanceId),
    queryFn: jsonFetcher<QualityProfile[]>(`/api/${service}/qualityprofiles`, instanceId),
    staleTime: REFERENCE_STALE,
    select: ensureArray,
  });
}

export function useTags(service: ArrService, instanceId?: string) {
  return useQuery({
    queryKey: queryKeys.tags(service, instanceId),
    queryFn: jsonFetcher<Tag[]>(`/api/${service}/tags`, instanceId),
    staleTime: REFERENCE_STALE,
    select: ensureArray,
  });
}

export function useRootFolders(service: ArrService, instanceId?: string) {
  return useQuery({
    queryKey: queryKeys.rootFolders(service, instanceId),
    queryFn: jsonFetcher<RootFolder[]>(`/api/${service}/rootfolders`, instanceId),
    staleTime: REFERENCE_STALE,
    select: ensureArray,
  });
}

/**
 * Union of tag suggestions across the given instances, de-duped by label
 * (case-insensitive). The list pages aggregate items from every connected instance, so
 * the bulk-tag picker must offer every instance's tags — not just the default one's.
 * Apply still resolves by label per target instance, so suggestions are advisory.
 */
export function useUnionTags(service: ArrService, instanceIds: string[]): Tag[] {
  return useQueries({
    queries: instanceIds.map((instanceId) => ({
      queryKey: queryKeys.tags(service, instanceId),
      queryFn: jsonFetcher<Tag[]>(`/api/${service}/tags`, instanceId),
      staleTime: REFERENCE_STALE,
      select: ensureArray,
    })),
    combine: (results) => {
      const byLabel = new Map<string, Tag>();
      for (const result of results) {
        // A mapped queries array erases per-query data types, so re-assert Tag[].
        for (const tag of (result.data ?? []) as Tag[]) {
          const key = tag.label.toLowerCase();
          if (!byLabel.has(key)) byLabel.set(key, tag);
        }
      }
      return [...byLabel.values()];
    },
  });
}

export function useMetadataProfiles(instanceId?: string) {
  return useQuery({
    queryKey: queryKeys.metadataProfiles(instanceId),
    queryFn: jsonFetcher<LidarrMetadataProfile[]>('/api/lidarr/metadataprofiles', instanceId),
    staleTime: REFERENCE_STALE,
    select: ensureArray,
  });
}
