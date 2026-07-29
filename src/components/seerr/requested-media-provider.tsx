'use client';

import { createContext, useCallback, useContext, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { jsonFetcher } from '@/lib/query-fetch';
import { hasCapability, useMe } from '@/components/permission-provider';
import {
  useDataDemand,
  useDataDemandRegistry,
  type RegisterDataDemand,
} from '@/lib/hooks/use-data-demand';

type MediaType = 'movie' | 'tv';
type Key = string; // `${mediaType}:${tmdbId}`

interface PendingRequestsResponse {
  results?: Array<{ mediaType: MediaType; tmdbId: number }>;
}

const keyOf = (mediaType: MediaType, tmdbId: number): Key => `${mediaType}:${tmdbId}`;

// Module-level (stable identity) so TanStack memoizes the derived Set: an inline
// select would re-run every render and hand back a new Set, churning the context
// value and re-rendering every Request button consumer.
function toRequestedSet(data: PendingRequestsResponse): Set<Key> {
  const next = new Set<Key>();
  for (const r of data.results ?? []) next.add(keyOf(r.mediaType, r.tmdbId));
  return next;
}

interface RequestedMediaContextValue {
  isRequested: (mediaType: MediaType, tmdbId: number) => boolean;
  markRequested: (mediaType: MediaType, tmdbId: number) => void;
}

const RequestedMediaContext = createContext<RequestedMediaContextValue | null>(null);
const RequestedMediaDemandContext = createContext<RegisterDataDemand>(() => () => {});
const NO_REQUESTED_MEDIA: RequestedMediaContextValue = {
  isRequested: () => false,
  markRequested: () => {},
};

/**
 * Tracks which media the current user has an outstanding request for, so a
 * Request button keeps reading "Requested" across remounts/navigation instead
 * of resetting to "Request". Seeded once from the Helprr-side pending list
 * (members see their own; the gate holds member requests there until an admin
 * approves), then updated optimistically when a request is submitted. State
 * lives at the app-layout level, so it survives in-app navigation; a hard
 * reload re-seeds from the server.
 */
export function RequestedMediaProvider({ children }: { children: React.ReactNode }) {
  const me = useMe();
  const available = me?.seerrConfigured === true && hasCapability(me, 'requests.create');
  const queryClient = useQueryClient();
  const { hasDemand, registerDemand } = useDataDemandRegistry();

  // The pending-requests fetch is best-effort: a failure should leave the set
  // empty rather than surface an error UI. `select` folds the response into the
  // Set<Key> shape consumers expect; the cache itself is the canonical store, so
  // optimistic marks persist across remounts/navigation the same as before.
  const { data: requested } = useQuery({
    queryKey: ['seerr', 'requested-media'],
    queryFn: jsonFetcher<PendingRequestsResponse>('/api/seerr/pending-requests?fields=keys'),
    enabled: available && hasDemand,
    select: toRequestedSet,
  });

  const isRequested = useCallback(
    (mediaType: MediaType, tmdbId: number) => requested?.has(keyOf(mediaType, tmdbId)) ?? false,
    [requested],
  );

  // Optimistically add to the cached response so the Request button keeps reading
  // "Requested" — `select` re-derives the Set on the next render.
  const markRequested = useCallback(
    (mediaType: MediaType, tmdbId: number) => {
      queryClient.setQueryData<PendingRequestsResponse>(['seerr', 'requested-media'], (prev) => {
        const results = prev?.results ?? [];
        if (results.some((r) => r.mediaType === mediaType && r.tmdbId === tmdbId)) return prev;
        return { ...prev, results: [...results, { mediaType, tmdbId }] };
      });
    },
    [queryClient],
  );

  const value = useMemo(() => ({ isRequested, markRequested }), [isRequested, markRequested]);

  return (
    <RequestedMediaDemandContext.Provider value={registerDemand}>
      <RequestedMediaContext.Provider value={value}>{children}</RequestedMediaContext.Provider>
    </RequestedMediaDemandContext.Provider>
  );
}

/** Read/update the current user's outstanding-request set. No-op outside the provider. */
export function useRequestedMedia(enabled: boolean): RequestedMediaContextValue {
  const registerDemand = useContext(RequestedMediaDemandContext);
  useDataDemand(registerDemand, enabled);
  return useContext(RequestedMediaContext) ?? NO_REQUESTED_MEDIA;
}
