'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { hasCapability, useMe } from '@/components/permission-provider';
import {
  anilistKey,
  arrKey,
  providerKey,
  type ArrScope,
  type SeriesEpisodesResponse,
  type WatchKind,
  type WatchStatus,
  type WatchStatusMapResponse,
} from '@/types/watch-status';

// One app-level fetch backs every grid/list/detail/anime surface; cards do an
// in-memory O(1) lookup, never a per-item fetch (same shape as RequestedMediaProvider).
// Writes are optimistic and roll back on error. Mirrors the de-duplicated wire
// format: keys → index into items.
const WATCH_MAP_KEY = ['jellyfin', 'watch-status', 'map'] as const;
const WATCH_STATUS_KEY = ['jellyfin', 'watch-status'] as const;
const SERIES_EPISODES_KEY = ['jellyfin', 'watch-status', 'series'] as const;

/** Any identifier a surface might hold; tried in priority order (arr id → anilist → tvdb → tmdb → imdb).
 *  `kind` is required to resolve a provider id, since movie/series tmdb id spaces overlap. */
export interface WatchLookupQuery {
  scope?: ArrScope;
  instanceId?: string;
  arrId?: number;
  anilistId?: number;
  kind?: WatchKind;
  tvdbId?: number | null;
  tmdbId?: number | null;
  imdbId?: string | null;
}

export interface SetWatchedArgs {
  jellyfinItemId: string;
  played: boolean;
  /** Jellyfin series id — pass for series/episode writes so that series' episode cache is dropped too. */
  seriesId?: string;
}

type WatchLookupFn = (query: WatchLookupQuery) => WatchStatus | undefined;

interface WatchActionsValue {
  setWatched: (args: SetWatchedArgs) => void;
  canWrite: boolean;
  isWriting: boolean;
}

// Read (lookup) and write (actions) live in separate contexts so a write in
// flight — which flips `isWriting` — doesn't churn the lookup value and re-render
// every grid card that only reads watch state.
const WatchLookupContext = createContext<WatchLookupFn>(() => undefined);
const WatchActionsContext = createContext<WatchActionsValue>({
  setWatched: () => {},
  canWrite: false,
  isWriting: false,
});

// Module-level (stable identity) so TanStack memoizes the derived Map instead of
// rebuilding a new one — and churning every consumer — on each render.
function toMap(data: WatchStatusMapResponse): Map<string, WatchStatus> {
  const map = new Map<string, WatchStatus>();
  for (const [key, idx] of Object.entries(data.keys)) {
    const status = data.items[idx];
    if (status) map.set(key, status);
  }
  return map;
}

// Apply an optimistic toggle to the RAW cached response (select re-derives the
// Map). A Series toggle fills/empties the episode count; a Movie toggle the %.
function applyOptimistic(prev: WatchStatusMapResponse, args: SetWatchedArgs): WatchStatusMapResponse {
  const items = prev.items.map((status): WatchStatus => {
    if (status.jellyfinItemId !== args.jellyfinItemId) return status;
    if (status.kind === 'movie') {
      return { ...status, played: args.played, playedPercentage: args.played ? 100 : 0 };
    }
    return {
      ...status,
      played: args.played,
      watchedEpisodeCount: args.played ? status.totalEpisodeCount : 0,
    };
  });
  return { ...prev, items };
}

export function WatchStatusProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const enabled = me?.jellyfinLinked === true && hasCapability(me, 'jellyfin.view');
  const canWrite = hasCapability(me, 'jellyfin.watchedState');
  const queryClient = useQueryClient();

  const { data: map } = useQuery({
    queryKey: WATCH_MAP_KEY,
    queryFn: jsonFetcher<WatchStatusMapResponse>('/api/jellyfin/watch-status'),
    enabled,
    select: toMap,
    // In-session navigation reuses the map; aligned with the server's 10m SWR.
    staleTime: 5 * 60_000,
  });

  const mutation = useMutation({
    mutationFn: async (args: SetWatchedArgs) => {
      const res = await fetch('/api/jellyfin/watch-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(args),
      });
      // Throw ApiError on 401 so the global mutationCache handler redirects to /login.
      if (res.status === 401) throw new ApiError(401, 'POST watch-status → 401');
      if (!res.ok) throw new Error('Failed to update watch status');
    },
    onMutate: async (args) => {
      await queryClient.cancelQueries({ queryKey: WATCH_STATUS_KEY });

      const prevMap = queryClient.getQueryData<WatchStatusMapResponse>(WATCH_MAP_KEY);
      if (prevMap) {
        queryClient.setQueryData<WatchStatusMapResponse>(WATCH_MAP_KEY, applyOptimistic(prevMap, args));
      }

      // An episode toggle carries the EPISODE's jellyfinItemId, which lives only
      // in the per-series episode caches (never in the map's items). Patch any
      // that hold it so the episode row flips instantly and can roll back.
      const prevEpisodes: Array<[QueryKey, SeriesEpisodesResponse]> = [];
      for (const [key, data] of queryClient.getQueriesData<SeriesEpisodesResponse>({ queryKey: SERIES_EPISODES_KEY })) {
        if (!data) continue;
        // Only the series-episode cache that actually holds this episode is cloned;
        // the rest cost just a find() (no throwaway copy on every toggle).
        const epKey = Object.keys(data.episodes).find((k) => data.episodes[k].jellyfinItemId === args.jellyfinItemId);
        if (!epKey) continue;
        prevEpisodes.push([key, data]);
        const ep = data.episodes[epKey];
        queryClient.setQueryData<SeriesEpisodesResponse>(key, {
          ...data,
          episodes: { ...data.episodes, [epKey]: { ...ep, played: args.played, playedPercentage: args.played ? 100 : 0 } },
        });
      }

      return { prevMap, prevEpisodes };
    },
    onError: (_error, _args, context) => {
      if (context?.prevMap) queryClient.setQueryData(WATCH_MAP_KEY, context.prevMap);
      for (const [key, data] of context?.prevEpisodes ?? []) {
        queryClient.setQueryData(key, data);
      }
      toast.error('Couldn’t update watch status');
    },
    onSettled: () => {
      // Refresh both the map and any open per-series episode query.
      void queryClient.invalidateQueries({ queryKey: WATCH_STATUS_KEY });
    },
  });

  const lookup = useCallback<WatchLookupFn>(
    (query) => {
      if (!map) return undefined;
      if (query.scope && query.instanceId && query.arrId != null) {
        const hit = map.get(arrKey(query.scope, query.instanceId, query.arrId));
        if (hit) return hit;
      }
      if (query.anilistId != null) {
        const hit = map.get(anilistKey(query.anilistId));
        if (hit) return hit;
      }
      if (query.kind) {
        if (query.tvdbId != null) {
          const hit = map.get(providerKey(query.kind, 'tvdb', query.tvdbId));
          if (hit) return hit;
        }
        if (query.tmdbId != null) {
          const hit = map.get(providerKey(query.kind, 'tmdb', query.tmdbId));
          if (hit) return hit;
        }
        if (query.imdbId) {
          const hit = map.get(providerKey(query.kind, 'imdb', query.imdbId));
          if (hit) return hit;
        }
      }
      return undefined;
    },
    [map],
  );

  // mutation.mutate is referentially stable, so setWatched is too — toggling
  // isWriting won't recreate it (only the actions value, consumed by the few
  // write surfaces, not the grid cards).
  const { mutate } = mutation;
  const setWatched = useCallback((args: SetWatchedArgs) => mutate(args), [mutate]);

  const actions = useMemo<WatchActionsValue>(
    () => ({ setWatched, canWrite, isWriting: mutation.isPending }),
    [setWatched, canWrite, mutation.isPending],
  );

  return (
    <WatchLookupContext.Provider value={lookup}>
      <WatchActionsContext.Provider value={actions}>{children}</WatchActionsContext.Provider>
    </WatchLookupContext.Provider>
  );
}

/** Read the current user's Jellyfin watch status. Stable across writes; returns undefined outside the provider. */
export function useWatchLookup(): WatchLookupFn {
  return useContext(WatchLookupContext);
}

/** Toggle watch status / read write-capability + in-flight state. Inert no-op outside the provider. */
export function useWatchStatus(): WatchActionsValue {
  return useContext(WatchActionsContext);
}
