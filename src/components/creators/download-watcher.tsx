'use client';

import { useEffect, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCreatorPlatform } from './platform';

const WATCH_KEY = 'active-downloads';
const WATCH_MS = 10_000;

/**
 * Lists only poll once they know something is downloading, so a download started by a rule or
 * another device stayed invisible until a reload. This watches the set of downloading videos
 * cheaply and refreshes the section's open pages when it changes.
 */
export function DownloadWatcher() {
  const platform = useCreatorPlatform();
  const queryClient = useQueryClient();
  const last = useRef<string | null>(null);
  const { data } = useQuery({
    queryKey: [platform.id, WATCH_KEY],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${platform.api}/jobs?active=1`, { signal });
      if (!res.ok) throw new Error('Could not check downloads');
      return (await res.json()) as { videoIds: string[] };
    },
    refetchInterval: WATCH_MS,
    refetchIntervalInBackground: false,
  });
  const signature = data?.videoIds.join(',');

  useEffect(() => {
    if (signature === undefined) return;
    if (last.current !== null && last.current !== signature) {
      void queryClient.invalidateQueries({ queryKey: [platform.id], predicate: (query) => query.queryKey[1] !== WATCH_KEY });
    }
    last.current = signature;
  }, [signature, queryClient, platform.id]);
  return null;
}
