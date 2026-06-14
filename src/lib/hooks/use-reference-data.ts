'use client';

import { useQuery } from '@tanstack/react-query';
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

export function useMetadataProfiles(instanceId?: string) {
  return useQuery({
    queryKey: queryKeys.metadataProfiles(instanceId),
    queryFn: jsonFetcher<LidarrMetadataProfile[]>('/api/lidarr/metadataprofiles', instanceId),
    staleTime: REFERENCE_STALE,
    select: ensureArray,
  });
}
