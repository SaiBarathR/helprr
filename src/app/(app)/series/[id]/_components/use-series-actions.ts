'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SonarrSeries } from '@/types';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
import { ApiError, arrMutationFetch } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { episodesWithFileKey } from '@/lib/series-query-cache';
import { pollCommand } from '@/lib/arr-command';
import { buildMonitorUpdate, MONITOR_OPTIONS } from './format';

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
  const [actionLoading, setActionLoading] = useState('');
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [showMonitorEdit, setShowMonitorEdit] = useState(false);
  const [monitorOption, setMonitorOption] = useState('');
  const [deleteFiles, setDeleteFiles] = useState(false);
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
    if (!series) return;
    setActionLoading('monitor');
    try {
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...series, monitored: !series.monitored }),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        // The series object is the single shared key — writing it here reflects on
        // the season + episode views (which read the same key) automatically.
        queryClient.setQueryData(queryKeys.detail('sonarr', seriesId, instance), updated);
        // Patch this series' monitored flag in the cached library lists
        // (slim/full/all-instances) instead of refetching the whole library —
        // preserves the server-resolved profile/tag labels.
        queryClient.setQueriesData({ queryKey: queryKeys.library('sonarr') }, (prev) =>
          Array.isArray(prev) ? prev.map((s) => (s.id === seriesId ? { ...s, monitored: updated.monitored } : s)) : prev);
        toast.success(updated.monitored ? 'Now monitored' : 'Unmonitored');
      }
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
      await arrMutationFetch(instance, '/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: 'MonitoredEpisodeCommand' in {} ? 'MonitoredEpisodeCommand' : 'RefreshSeries',
          seriesId: series.id,
        }),
      });
      // Update series monitored state via PUT
      const updateRes = await arrMutationFetch(instance, `/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(buildMonitorUpdate(series, monitorOption)),
      });
      if (updateRes.ok) {
        const updated: SonarrSeries = await updateRes.json();
        queryClient.setQueryData(queryKeys.detail('sonarr', seriesId, instance), updated);
        // Monitor option also shifts episode monitored flags → refresh list + episodes.
        invalidateSeries(queryClient, { itemId: seriesId, instanceId: instance });
        toast.success(`Monitor set to: ${MONITOR_OPTIONS.find((o) => o.value === monitorOption)?.label}`);
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
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}?deleteFiles=${deleteFiles}`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      invalidateSeries(queryClient);
      queryClient.removeQueries({ queryKey: queryKeys.detail('sonarr', series.id, instance) });
      queryClient.removeQueries({ queryKey: queryKeys.episodes(series.id, instance) });
      queryClient.removeQueries({ queryKey: episodesWithFileKey(series.id, instance) });
      queryClient.removeQueries({ queryKey: queryKeys.anime(series.id, instance) });
      queryClient.removeQueries({ queryKey: queryKeys.credits('sonarr', series.id, instance) });
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
