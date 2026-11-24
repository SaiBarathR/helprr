'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SonarrSeries } from '@/types';
import { queryKeys } from '@/lib/query-keys';
import { invalidateAfterLibraryRemove, invalidateSeries, patchLibraryMonitored } from '@/lib/query-invalidation';
import { ApiError, arrMutationFetch } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { episodesWithFileKey } from '@/lib/series-query-cache';
import { pollCommand } from '@/lib/arr-command';
import { seriesMonitorLabel } from '@/lib/series-monitor';
import { useRemoveQueriesOnUnmount } from '@/lib/hooks/use-remove-queries-on-unmount';

/**
 * What the series page does to Sonarr (and Jellyfin's lookup): monitoring,
 * refresh, search, monitoring options, delete. Each write updates the shared
 * query cache the season and episode views read too.
 */
export function useSeriesActions({
  series,
  seriesId,
  instance,
  jellyfinUrl,
  refetch,
  onDeleted,
}: {
  series: SonarrSeries | null;
  seriesId: number;
  instance: string | undefined;
  jellyfinUrl: string | undefined;
  /** Refetch the series and its episodes after a refresh. */
  refetch: () => Promise<unknown>;
  onDeleted: () => void;
}) {
  const queryClient = useQueryClient();
  const removeOnUnmount = useRemoveQueriesOnUnmount();
  const [actionLoading, setActionLoading] = useState('');
  const monitorQueue = useRef<Promise<void>>(Promise.resolve());
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [showMonitorEdit, setShowMonitorEdit] = useState(false);
  const [monitorOption, setMonitorOption] = useState('');
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [addExclusion, setAddExclusion] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function handleOpenInJellyfin() {
    if (!series || !jellyfinUrl) return;
    const popup = window.open('', '_blank');
    if (!popup) {
      toast.error('Popup blocked');
      return;
    }

    setJellyfinLoading(true);
    try {
      const params = new URLSearchParams();
      if (series.imdbId) params.set('imdbId', series.imdbId);
      if (series.tvdbId) params.set('tvdbId', String(series.tvdbId));
      if (!params.toString()) {
        popup.close();
        toast.error('No provider IDs available');
        return;
      }
      const res = await fetch(`/api/jellyfin/lookup?${params}`);
      if (res.status === 401) {
        popup.close();
        handleAuthError(new ApiError(401, 'Session expired'));
        return;
      }
      const data = res.ok ? await res.json() : null;
      if (data?.itemId) {
        popup.location.href = `${jellyfinUrl}/web/index.html#!/details?id=${data.itemId}`;
      } else {
        popup.close();
        toast.error('Not found in Jellyfin');
      }
    } catch {
      popup.close();
      toast.error('Jellyfin lookup failed');
    } finally {
      setJellyfinLoading(false);
    }
  }

  async function handleSearchAll() {
    if (!series) return;
    setActionLoading('search');
    try {
      const res = await arrMutationFetch(instance, '/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeriesSearch', seriesId: series.id }),
      });
      if (!res.ok) throw new Error(`SeriesSearch → ${res.status}`);
      toast.success('Series search started');
    } catch (e) { handleAuthError(e); toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (series) await setMonitored(series, !series.monitored);
  }

  // Monitor writes for this series run one at a time, so an Undo tapped while
  // another write is still in flight runs after it and its intent wins.
  function setMonitored(fallback: SonarrSeries, monitored: boolean) {
    const run = monitorQueue.current.then(() => putMonitored(fallback, monitored));
    monitorQueue.current = run;
    return run;
  }

  async function putMonitored(fallback: SonarrSeries, monitored: boolean) {
    // Send the latest cached series when the write runs, so edits made meanwhile survive.
    const base = queryClient.getQueryData<SonarrSeries | null>(queryKeys.detail('sonarr', seriesId, instance)) ?? fallback;
    setActionLoading('monitor');
    try {
      const res = await arrMutationFetch(instance, `/api/sonarr/${base.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...base, monitored }),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        // The series object is the single shared key — writing it here reflects on
        // the season + episode views (which read the same key) automatically.
        queryClient.setQueryData(queryKeys.detail('sonarr', seriesId, instance), updated);
        patchLibraryMonitored(queryClient, 'sonarr', { itemId: seriesId, instanceId: instance, monitored: updated.monitored });
        if (updated.monitored) toast.success('Now monitored');
        // Unmonitoring is a library change, so a stray tap must be recoverable.
        else toast.success('Unmonitored', {
          action: { label: 'Undo', onClick: () => { void setMonitored(updated, true); } },
        });
      } else toast.error('Failed to update');
    } catch (e) { handleAuthError(e); toast.error('Failed to update'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleSeasonMonitor(seasonNumber: number, monitored: boolean) {
    if (!series) return;
    try {
      const updatedSeries = {
        ...series,
        seasons: series.seasons.map((s) =>
          s.seasonNumber === seasonNumber ? { ...s, monitored } : s
        ),
      };
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        // Shared detail key → reflects on the series-detail + season + episode views.
        // No library invalidation: a season-monitor change doesn't alter the
        // series-level `monitored` shown in the list.
        queryClient.setQueryData(queryKeys.detail('sonarr', seriesId, instance), updated);
        toast.success(`Season ${seasonNumber} ${monitored ? 'monitored' : 'unmonitored'}`);
      }
    } catch (e) { handleAuthError(e); toast.error('Failed to update season'); }
  }

  async function handleApplyMonitor() {
    if (!series || !monitorOption) return;
    setActionLoading('applyMonitor');
    try {
      // Sonarr sets each episode's flag by its own rules for the choice.
      const res = await arrMutationFetch(instance, '/api/sonarr/seasonpass', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids: [series.id], monitor: monitorOption }),
      });
      if (res.ok) {
        // Episode flags, season flags and (for None) the series' own flag changed:
        // refetch the series, its episodes and the list.
        invalidateSeries(queryClient, { itemId: seriesId, instanceId: instance });
        toast.success(`Monitor set to: ${seriesMonitorLabel(monitorOption)}`);
        setShowMonitorEdit(false);
      } else {
        toast.error('Failed to update monitor');
      }
    } catch (e) { handleAuthError(e); toast.error('Failed to update monitor'); }
    finally { setActionLoading(''); }
  }

  async function handleRefresh() {
    if (!series) return;
    setActionLoading('refresh');
    try {
      const res = await arrMutationFetch(instance, '/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshSeries', seriesId: series.id }),
      });
      if (!res.ok) throw new Error('Refresh failed');
      const command = await res.json() as { id?: number };
      toast.success('Refresh started');
      const status = command.id ? await pollCommand('sonarr', command.id, instance) : 'completed';
      invalidateSeries(queryClient);
      await refetch();
      if (status === 'completed') toast.success('Refresh complete');
      else if (status === 'timeout') toast.warning('Refresh still running');
      else toast.error('Refresh failed');
    } catch (e) { handleAuthError(e); toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleDelete() {
    if (!series) return;
    setDeleting(true);
    try {
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}?deleteFiles=${deleteFiles}&addImportListExclusion=${addExclusion}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      invalidateSeries(queryClient);
      invalidateAfterLibraryRemove(queryClient, 'sonarr', [{ id: series.id, instanceId: instance }]);
      removeOnUnmount(
        queryKeys.detail('sonarr', series.id, instance),
        queryKeys.episodes(series.id, instance),
        episodesWithFileKey(series.id, instance),
        queryKeys.anime(series.id, instance),
        queryKeys.credits('sonarr', series.id, instance),
      );
      toast.success('Series deleted');
      onDeleted();
    } catch (e) { handleAuthError(e); toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  return {
    actionLoading,
    jellyfinLoading,
    showMonitorEdit,
    setShowMonitorEdit,
    monitorOption,
    setMonitorOption,
    deleteFiles,
    setDeleteFiles,
    addExclusion,
    setAddExclusion,
    deleting,
    openInJellyfin: handleOpenInJellyfin,
    searchAll: handleSearchAll,
    toggleMonitored: handleToggleMonitored,
    toggleSeasonMonitor: handleToggleSeasonMonitor,
    applyMonitor: handleApplyMonitor,
    refresh: handleRefresh,
    deleteSeries: handleDelete,
  };
}

export type SeriesActions = ReturnType<typeof useSeriesActions>;
