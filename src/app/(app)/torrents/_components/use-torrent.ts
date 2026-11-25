'use client';

import { useCallback } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ApiError, withInstanceQuery } from '@/lib/query-fetch';
import type { QBittorrentTorrent } from '@/types';
import { qbitInstanceKey, useQbitInstance } from './use-qbit-instance';

export const torrentQueryKey = (hash: string, instanceId?: string) => ['qbittorrent', 'torrent', hash, qbitInstanceKey(instanceId)] as const;

/** One torrent's live info, in the chosen qBittorrent; null once it no longer has it. */
export function useTorrent(hash: string) {
  const { instanceId } = useQbitInstance();
  return useQuery({
    queryKey: torrentQueryKey(hash, instanceId),
    queryFn: async ({ signal }): Promise<QBittorrentTorrent | null> => {
      const res = await fetch(withInstanceQuery(`/api/qbittorrent?hashes=${encodeURIComponent(hash)}`, instanceId), { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/qbittorrent → ${res.status}`);
      const torrents = (await res.json()) as QBittorrentTorrent[];
      return torrents.find((t) => t.hash === hash) ?? null;
    },
    // It can change elsewhere (the list, another device); read fresh on each visit.
    staleTime: 0,
  });
}

export interface TorrentOptions {
  tags: string[];
  queueingEnabled: boolean;
}

/** qBittorrent's tags and whether its queueing is on, for the settings pages. */
export function useTorrentOptions() {
  const { instanceId } = useQbitInstance();
  return useQuery({
    queryKey: ['qbittorrent', 'options', qbitInstanceKey(instanceId)] as const,
    queryFn: async ({ signal }): Promise<TorrentOptions> => {
      const res = await fetch(withInstanceQuery('/api/qbittorrent/options', instanceId), { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/qbittorrent/options → ${res.status}`);
      return res.json();
    },
    staleTime: 30_000,
  });
}

async function postTorrentAction({ body, instanceId }: { body: Record<string, unknown>; instanceId?: string }): Promise<void> {
  const res = await fetch(withInstanceQuery('/api/qbittorrent', instanceId), {
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
  const { instanceId } = useQbitInstance();
  const { mutateAsync } = useMutation({ mutationFn: postTorrentAction });
  return useCallback(async (body: Record<string, unknown>): Promise<boolean> => {
    try {
      await mutateAsync({ body, instanceId });
      return true;
    } catch (err) {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (!(err instanceof ApiError && err.status === 401)) {
        toast.error(err instanceof Error ? err.message : 'Action failed');
      }
      return false;
    }
  }, [instanceId, mutateAsync]);
}
