'use client';

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';
import { jsonFetcher } from '@/lib/query-fetch';
import { useCan } from '@/components/permission-provider';
import type { QueueItem } from '@/types';

export interface ArrQueueState {
  /** 0–100, from Radarr/Sonarr's own size vs sizeleft. */
  progressPct: number;
  status: string;
}

type QueueKey = string;

function keyFor(scope: 'radarr' | 'sonarr', instanceId: string | undefined, id: number): QueueKey {
  return `${scope}:${instanceId ?? ''}:${id}`;
}

/**
 * One queue fetch, indexed by arr scope + instance + media id.
 *
 * Cards need "is this downloading right now"; asking per card would be one
 * request each, so the whole queue is fetched once and looked up locally. Keys
 * omit nothing — a Radarr id and a Sonarr id can collide, and so can the same
 * id across two instances.
 */
export function useArrQueueLookup(): (ref: { scope: 'radarr' | 'sonarr'; instanceId?: string; id: number } | undefined) => ArrQueueState | undefined {
  const canSeeQueue = useCan('activity.view');
  const query = useQuery({
    queryKey: ['jellyfin', 'catalog', 'arr-queue'],
    queryFn: jsonFetcher<{ records: QueueItem[] }>('/api/activity/queue?page=1&pageSize=200'),
    enabled: canSeeQueue,
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const index = useMemo(() => {
    const map = new Map<QueueKey, ArrQueueState>();
    for (const record of query.data?.records ?? []) {
      const size = record.size ?? 0;
      const left = record.sizeleft ?? 0;
      const progressPct = size > 0 ? Math.max(0, Math.min(100, ((size - left) / size) * 100)) : 0;
      const state: ArrQueueState = { progressPct, status: record.trackedDownloadState || record.status || '' };
      if (record.movieId) map.set(keyFor('radarr', record.instanceId, record.movieId), state);
      if (record.seriesId) map.set(keyFor('sonarr', record.instanceId, record.seriesId), state);
    }
    return map;
  }, [query.data]);

  return (ref) => (ref ? index.get(keyFor(ref.scope, ref.instanceId, ref.id)) : undefined);
}
