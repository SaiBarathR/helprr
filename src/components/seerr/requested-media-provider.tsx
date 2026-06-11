'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useMe } from '@/components/permission-provider';

type MediaType = 'movie' | 'tv';
type Key = string; // `${mediaType}:${tmdbId}`

const keyOf = (mediaType: MediaType, tmdbId: number): Key => `${mediaType}:${tmdbId}`;

interface RequestedMediaContextValue {
  isRequested: (mediaType: MediaType, tmdbId: number) => boolean;
  markRequested: (mediaType: MediaType, tmdbId: number) => void;
}

const RequestedMediaContext = createContext<RequestedMediaContextValue | null>(null);

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
  const seerrConfigured = me?.seerrConfigured ?? false;
  const [requested, setRequested] = useState<Set<Key>>(new Set());

  useEffect(() => {
    if (!seerrConfigured) return;
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch('/api/seerr/pending-requests?fields=keys');
        if (!res.ok) return;
        const data = (await res.json()) as { results?: Array<{ mediaType: MediaType; tmdbId: number }> };
        if (cancelled) return;
        setRequested((prev) => {
          const next = new Set(prev);
          for (const r of data.results ?? []) next.add(keyOf(r.mediaType, r.tmdbId));
          return next;
        });
      } catch {
        // best-effort — leave the set as-is
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [seerrConfigured]);

  const isRequested = useCallback(
    (mediaType: MediaType, tmdbId: number) => requested.has(keyOf(mediaType, tmdbId)),
    [requested],
  );

  const markRequested = useCallback((mediaType: MediaType, tmdbId: number) => {
    setRequested((prev) => {
      const key = keyOf(mediaType, tmdbId);
      if (prev.has(key)) return prev;
      const next = new Set(prev);
      next.add(key);
      return next;
    });
  }, []);

  const value = useMemo(() => ({ isRequested, markRequested }), [isRequested, markRequested]);

  return <RequestedMediaContext.Provider value={value}>{children}</RequestedMediaContext.Provider>;
}

/** Read/update the current user's outstanding-request set. No-op outside the provider. */
export function useRequestedMedia(): RequestedMediaContextValue {
  return (
    useContext(RequestedMediaContext) ?? {
      isRequested: () => false,
      markRequested: () => {},
    }
  );
}
