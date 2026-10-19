import { useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { passiveTorrentRefreshIntervalMs } from '@/lib/qbittorrent-summary';
import { applyTorrentDelta, type TorrentDeltaResponse } from '@/lib/qbittorrent-delta';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { backoffRefetchInterval } from '@/lib/query-fetch';
import type { QBittorrentTorrent, QBittorrentSummaryResponse, QBittorrentTransferInfo } from '@/types';
import type { TorrentsFilterPreference as FilterType } from '@/lib/store';
import { mergeTorrents, type PendingFieldOverride } from './torrent-list';

/**
 * The torrent list as qBittorrent reports it, polled as deltas, with the
 * optimistic overrides (row fields, delete tombstones, alt speed mode) that a
 * poll must not revert until it confirms them.
 */
export function useTorrentsSummary(filter: FilterType[], hasHydrated: boolean) {
  const [torrents, setTorrents] = useState<QBittorrentTorrent[]>([]);
  const [transferInfo, setTransferInfo] = useState<QBittorrentTransferInfo | null>(null);
  const [speedLimitsMode, setSpeedLimitsMode] = useState(0);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  // When exactly one filter is active, push it to qBittorrent so the server slims
  // the payload. Multi-select uses OR semantics the qBit `filter` param doesn't
  // support, so we fetch all + filter client-side in that case. The signature is
  // part of the query key so switching filters refetches immediately.
  const filterSignature = filter.length === 1 ? filter[0] : filter.length === 0 ? '__all__' : '__multi__';
  const deltaSnapshots = useRef(new Map<string, { cursor: string; payload: QBittorrentSummaryResponse }>());

  const summaryQuery = useQuery({
    queryKey: ['torrents', 'summary', filterSignature],
    queryFn: async ({ signal }): Promise<QBittorrentSummaryResponse> => {
      const params = new URLSearchParams();
      if (filterSignature !== '__all__' && filterSignature !== '__multi__') params.set('filter', filterSignature);
      const previous = deltaSnapshots.current.get(filterSignature);
      params.set('view', 'delta');
      if (previous) params.set('cursor', previous.cursor);
      const qs = params.toString();
      const res = await fetch(qs ? `/api/qbittorrent/summary?${qs}` : '/api/qbittorrent/summary', { signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = (await res.json()) as TorrentDeltaResponse & { error?: string };
      if (data.error) throw new Error(data.error);
      signal.throwIfAborted();
      try {
        const payload = applyTorrentDelta(previous?.payload, data);
        deltaSnapshots.current.set(filterSignature, { cursor: data.cursor, payload });
        // The finite upstream filter set is small; cap defensively as well.
        if (deltaSnapshots.current.size > 16) deltaSnapshots.current.delete(deltaSnapshots.current.keys().next().value!);
        return payload;
      } catch (error) {
        deltaSnapshots.current.delete(filterSignature);
        throw error; // The next query retry requests a full reset.
      }
    },
    enabled: hasHydrated,
    refetchInterval: backoffRefetchInterval(passiveTorrentRefreshIntervalMs(refreshIntervalMs, typeof navigator === 'undefined' ? undefined : (navigator as Navigator & { connection?: { saveData?: boolean; effectiveType?: string } }).connection)),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const refetchSummary = summaryQuery.refetch;

  // Optimistic overrides awaiting server confirmation, keyed by hash.
  // qBittorrent applies actions asynchronously, so a poll can still report the
  // pre-action data right after an action; while an override is pending (and
  // unexpired) such a poll must not revert the row. Deletes get tombstones
  // (hash → expiry) that suppress re-insertion until the server stops
  // reporting the torrent.
  const pendingFieldRef = useRef(new Map<string, PendingFieldOverride>());
  const pendingDeleteRef = useRef(new Map<string, number>());
  // Optimistic alt-speed-mode flip awaiting confirmation (same idea, one value).
  const pendingSpeedModeRef = useRef<{ value: number; prev: number; until: number } | null>(null);

  // Mirror of `torrents` so the merge effect and torrentAction can read the
  // committed list without adding it to deps (which would churn row callbacks).
  // Updated on commit, before the merge effect below runs.
  const torrentsRef = useRef(torrents);
  useEffect(() => {
    torrentsRef.current = torrents;
  }, [torrents]);

  // Merge new data into local state so polls preserve UI ordering/identity
  // (mergeTorrents reconciles by hash instead of replacing the list wholesale).
  // Reconciliation of pending overrides happens HERE, outside the setTorrents
  // updater: updaters must stay pure (they can re-run), and deleting overrides
  // inside one could clear them before the state is actually committed.
  useEffect(() => {
    const data = summaryQuery.data;
    if (!data) return;
    const now = Date.now();
    let merged = mergeTorrents(torrentsRef.current, data.torrents);

    const tombstones = pendingDeleteRef.current;
    if (tombstones.size > 0) {
      const serverHashes = new Set(data.torrents.map((t) => t.hash));
      for (const [hash, until] of tombstones) {
        // Confirmed (server no longer reports it) or expired.
        if (!serverHashes.has(hash) || now > until) tombstones.delete(hash);
      }
      if (tombstones.size > 0) merged = merged.filter((t) => !tombstones.has(t.hash));
    }

    const pending = pendingFieldRef.current;
    if (pending.size > 0) {
      merged = merged.map((t) => {
        const override = pending.get(t.hash);
        if (!override) return t;
        if (t[override.field] !== override.prev || now > override.until) {
          // Confirmed (field moved off the pre-action value) or expired.
          pending.delete(t.hash);
          return t;
        }
        return { ...t, [override.field]: override.value };
      });
      for (const hash of pending.keys()) {
        if (!merged.some((t) => t.hash === hash)) pending.delete(hash);
      }
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect -- each poll's answer is merged into local state with the pending overrides (see above)
    setTorrents(merged);
    setTransferInfo(data.transferInfo);

    const serverMode = data.speedLimitsMode ?? 0;
    const modeOverride = pendingSpeedModeRef.current;
    if (modeOverride && serverMode === modeOverride.prev && now <= modeOverride.until) {
      setSpeedLimitsMode(modeOverride.value);
    } else {
      pendingSpeedModeRef.current = null;
      setSpeedLimitsMode(serverMode);
    }
  }, [summaryQuery.data]);

  // The query is disabled until the store hydrates, so isLoading stays false in
  // that gap — treat it as loading to avoid a brief "No torrents found" flash.
  const loading = !hasHydrated || summaryQuery.isLoading;
  const { refreshing, refresh } = useRefreshAction(refetchSummary);
  const error = summaryQuery.isError
    ? summaryQuery.error instanceof Error
      ? summaryQuery.error.message
      : 'Failed to fetch torrents'
    : null;

  useEffect(() => {
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  return {
    torrents,
    setTorrents,
    transferInfo,
    speedLimitsMode,
    setSpeedLimitsMode,
    refetchSummary,
    pendingFieldRef,
    pendingDeleteRef,
    pendingSpeedModeRef,
    torrentsRef,
    loading,
    refreshing,
    refresh,
    error,
  };
}
