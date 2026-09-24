'use client';

import { useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError } from '@/lib/query-fetch';
import type { QBittorrentTorrent } from '@/types';

export const torrentQueryKey = (hash: string) => ['qbittorrent', 'torrent', hash] as const;

/** One torrent's live info; null once qBittorrent no longer has it. */
export function useTorrent(hash: string) {
  return useQuery({
    queryKey: torrentQueryKey(hash),
    queryFn: async ({ signal }): Promise<QBittorrentTorrent | null> => {
      const res = await fetch(`/api/qbittorrent?hashes=${encodeURIComponent(hash)}`, { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/qbittorrent → ${res.status}`);
      const torrents = (await res.json()) as QBittorrentTorrent[];
      return torrents.find((t) => t.hash === hash) ?? null;
    },
    // It can change elsewhere (the list, another device); read fresh on each visit.
    staleTime: 0,
  });
}

async function postTorrentAction(body: Record<string, unknown>): Promise<void> {
  const res = await fetch('/api/qbittorrent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    // ApiError so a 401 reaches the global MutationCache handler (redirect).
    throw new ApiError(res.status, data?.error || 'Action failed');
  }
}

/**
 * Posts a torrent action (`hash` may join several with '|'). Resolves false once
 * the failure has been toasted, which is also SpeedLimitInput's contract.
 */
export function useTorrentAction() {
  const { mutateAsync } = useMutation({ mutationFn: postTorrentAction });
  return useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      await mutateAsync(body);
      return true;
    } catch (err) {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error(err instanceof Error ? err.message : 'Action failed');
      }
      return false;
    }
  }, [mutateAsync]);
}
