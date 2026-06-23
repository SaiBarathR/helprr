'use client';

import { useQuery } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { hasCapability, useMe } from '@/components/permission-provider';
import type { EpisodeWatchStatus, SeriesEpisodesResponse } from '@/types/watch-status';

const EMPTY: Record<string, EpisodeWatchStatus> = {};

/**
 * Per-series Jellyfin episode watch map, keyed `S{season}E{episode}`. Shared by
 * the series-detail expanded list, the season page, and the episode page so all
 * three read one cache entry. Disabled (and harmless) when Jellyfin isn't linked
 * or no provider id is known. `jellyfinSeriesId` is returned for write-back
 * cache invalidation.
 */
export function useSeriesEpisodeWatch(ids: {
  tvdbId?: number | null;
  tmdbId?: number | null;
  imdbId?: string | null;
}): { episodes: Record<string, EpisodeWatchStatus>; jellyfinSeriesId: string | null } {
  // Match the library map's gate: linked AND able to view — the server route
  // enforces jellyfin.view, so a linked-but-unauthorized user must not fire a
  // request that's guaranteed to be rejected.
  const me = useMe();
  const canRead = me?.jellyfinLinked === true && hasCapability(me, 'jellyfin.view');
  const params = new URLSearchParams();
  if (ids.imdbId) params.set('imdbId', ids.imdbId);
  if (ids.tvdbId) params.set('tvdbId', String(ids.tvdbId));
  if (ids.tmdbId) params.set('tmdbId', String(ids.tmdbId));
  const qs = params.toString();

  const { data } = useQuery({
    queryKey: ['jellyfin', 'watch-status', 'series', qs],
    queryFn: jsonFetcher<SeriesEpisodesResponse>(`/api/jellyfin/watch-status/series?${qs}`),
    enabled: canRead && qs.length > 0,
    staleTime: 5 * 60_000,
  });

  return { episodes: data?.episodes ?? EMPTY, jellyfinSeriesId: data?.jellyfinSeriesId ?? null };
}
