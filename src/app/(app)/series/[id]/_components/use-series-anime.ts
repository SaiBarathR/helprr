'use client';

import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { SonarrSeries } from '@/types';
import type {
  AniListDetailResponse,
  SeriesAniListEntryDetailResponse,
  SeriesAniListResponse,
} from '@/types/anilist';
import { queryKeys } from '@/lib/query-keys';
import { arrMutationFetch } from '@/lib/query-fetch';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

// The anime query holds the mapping/primary detail (animeData) plus the lazily
// accumulated per-tab details (detailsById) in one cache entry — both survive
// back-nav via gcTime, mirroring the old snapshot's animeData + animeDetailsById.
interface AnimePayload {
  animeData: SeriesAniListResponse;
  detailsById: Map<number, AniListDetailResponse>;
}

const EMPTY_ANIME_DETAILS: Map<number, AniListDetailResponse> = new Map();

/**
 * An anime series' AniList side: the mapping and each linked season's detail
 * (the primary on load, the others lazily per tab), kept fresh in the
 * background, plus the remap drawer's hydrated set.
 */
export function useSeriesAnime({
  series,
  seriesId,
  instance,
}: {
  series: SonarrSeries | null;
  seriesId: number;
  instance: string | undefined;
}) {
  const queryClient = useQueryClient();
  // Read by async callbacks, after commit: the series on screen and its on-screen AniList entry.
  const currentSeriesIdRef = useRef(seriesId);
  const activeAnimeEntryIdRef = useRef<number | null>(null);
  useEffect(() => {
    currentSeriesIdRef.current = seriesId;
  }, [seriesId]);

  const [activeDetailLoading, setActiveDetailLoading] = useState(false);
  // Full detail set hydrated when the remap drawer opens (suggestions need every entry's relations),
  // for the series it was loaded for: another series (Next keeps this mounted) starts without it.
  const drawerKey = `${seriesId}|${instance ?? ''}`;
  const [drawerState, setDrawerState] = useState<{ key: string; details: AniListDetailResponse[] } | null>(null);
  if (drawerState && drawerState.key !== drawerKey) setDrawerState(null);
  const drawerDetails = drawerState?.key === drawerKey ? drawerState.details : null;
  const [animeOverviewExpanded, setAnimeOverviewExpanded] = useRouteViewState('SeriesDetailPage:animeOverviewExpanded', false);
  const [showAniListRemap, setShowAniListRemap] = useState(false);
  const [activeAnimeTab, setActiveAnimeTab] = useRouteViewState('SeriesDetailPage:activeAnimeTab', 0);
  // Season chip expanded to its full name (mobile has no hover), keyed by anilistMediaId.
  const [expandedAnimeTabId, setExpandedAnimeTabId] = useRouteViewState<number | null>('SeriesDetailPage:expandedAnimeTabId', null);
  const [animeNowMs, setAnimeNowMs] = useState(() => Date.now());

  // AniList payload (anime series only). The lazy per-tab fetches, background
  // refresh, remap hydration and resync all merge into this one cache entry via
  // queryClient.setQueryData (see below) instead of bespoke snapshot writes.
  const animeKey = queryKeys.anime(seriesId, instance);
  const animeQuery = useQuery({
    queryKey: animeKey,
    queryFn: async ({ signal }): Promise<AnimePayload> => {
      const res = await arrMutationFetch(instance, `/api/sonarr/${seriesId}/anime`, { signal });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || 'Failed to load AniList details');
      }
      const data: SeriesAniListResponse = await res.json();
      const detailsById = new Map<number, AniListDetailResponse>();
      for (const detail of data.details) detailsById.set(detail.id, detail);
      return { animeData: data, detailsById };
    },
    enabled: Number.isFinite(seriesId) && !!series?.id && series.seriesType === 'anime',
  });
  const animeData = animeQuery.data?.animeData ?? null;
  const animeDetailsById = animeQuery.data?.detailsById ?? EMPTY_ANIME_DETAILS;
  const animeLoading = animeQuery.isLoading;

  // Surface AniList load failures as a toast (parity with the old fetch's catch).
  useEffect(() => {
    if (animeQuery.isError) {
      toast.error(animeQuery.error instanceof Error ? animeQuery.error.message : 'Failed to load AniList details');
    }
  }, [animeQuery.isError, animeQuery.error]);

  useEffect(() => {
    if (series?.seriesType !== 'anime' || !series?.id) return;

    let cancelled = false;

    // Refresh only the on-screen tab's detail (fresh airing countdown) — one
    // cached AniList lookup instead of refetching every linked season.
    const refreshAnimeData = async () => {
      const entryId = activeAnimeEntryIdRef.current;
      if (entryId == null) return;
      try {
        const response = await arrMutationFetch(instance, `/api/sonarr/${series.id}/anime?detail=${entryId}`);
        if (!response.ok) return;
        const data: SeriesAniListEntryDetailResponse = await response.json();
        if (cancelled) return;

        if (data.detail) {
          const detail = data.detail;
          queryClient.setQueryData<AnimePayload>(queryKeys.anime(seriesId, instance), (prev) => {
            if (!prev) return prev;
            const detailsById = new Map(prev.detailsById).set(entryId, detail);
            return { animeData: { ...prev.animeData, mapping: data.mapping }, detailsById };
          });
          return;
        }

        // The on-screen entry was pruned server-side — resync mapping + primary.
        const full = await arrMutationFetch(instance, `/api/sonarr/${series.id}/anime`);
        if (!full.ok) return;
        const fullData: SeriesAniListResponse = await full.json();
        if (cancelled) return;
        setActiveAnimeTab(0);
        queryClient.setQueryData<AnimePayload>(queryKeys.anime(seriesId, instance), (prev) => {
          const detailsById = new Map(prev?.detailsById ?? []);
          detailsById.delete(entryId);
          for (const detail of fullData.details) detailsById.set(detail.id, detail);
          return { animeData: fullData, detailsById };
        });
      } catch {
        // Keep the current detail on background refresh failures.
      }
    };

    const intervalId = window.setInterval(() => {
      void refreshAnimeData();
    }, 10 * 60 * 1000);

    const handleVisibilityOrFocus = () => {
      if (document.visibilityState === 'hidden') return;
      void refreshAnimeData();
    };

    window.addEventListener('focus', handleVisibilityOrFocus);
    document.addEventListener('visibilitychange', handleVisibilityOrFocus);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
      window.removeEventListener('focus', handleVisibilityOrFocus);
      document.removeEventListener('visibilitychange', handleVisibilityOrFocus);
    };
  }, [series?.id, series?.seriesType, seriesId, instance, queryClient, setActiveAnimeTab]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- re-anchor "now" when the on-screen season changes
    setAnimeNowMs(Date.now());

    const entries = animeData?.mapping.entries ?? [];
    const entryId = entries[Math.min(activeAnimeTab, Math.max(0, entries.length - 1))]?.anilistMediaId;
    const activeDetail = entryId != null ? animeDetailsById.get(entryId) ?? null : null;
    if (!activeDetail?.nextAiringEpisode) return;

    const tick = window.setInterval(() => {
      setAnimeNowMs(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(tick);
    };
  }, [animeData, activeAnimeTab, animeDetailsById]);

  // The remap drawer needs every linked entry's detail (covers + relation
  // suggestions) — hydrate the full set once per open. Hot in Redis, so cheap.
  useEffect(() => {
    if (!showAniListRemap || !series?.id || series.seriesType !== 'anime') return;

    const controller = new AbortController();
    const activeSeriesId = seriesId;
    arrMutationFetch(instance, `/api/sonarr/${series.id}/anime?full=1`, { signal: controller.signal })
      .then((r) => (r.ok ? (r.json() as Promise<SeriesAniListResponse>) : null))
      .then((data) => {
        if (!data || activeSeriesId !== currentSeriesIdRef.current) return;
        setDrawerState({ key: `${activeSeriesId}|${instance ?? ''}`, details: data.details });
        queryClient.setQueryData<AnimePayload>(queryKeys.anime(activeSeriesId, instance), (prev) => {
          const detailsById = new Map(prev?.detailsById ?? []);
          for (const detail of data.details) detailsById.set(detail.id, detail);
          return { animeData: data, detailsById };
        });
      })
      .catch(() => {
        // Drawer falls back to whichever details are already loaded.
      });

    return () => controller.abort();
  }, [showAniListRemap, series?.id, series?.seriesType, seriesId, instance, queryClient]);

  // Lazy per-tab detail fetch. The page-load GET only returns the primary;
  // other seasons load (and validate) here on first select.
  function selectAnimeTab(index: number) {
    setActiveAnimeTab(index);
    const entryId = (animeData?.mapping.entries ?? [])[index]?.anilistMediaId;
    if (entryId == null || animeDetailsById.has(entryId) || !series?.id) return;

    const activeSeriesId = seriesId;
    setActiveDetailLoading(true);
    arrMutationFetch(instance, `/api/sonarr/${series.id}/anime?detail=${entryId}`)
      .then((r) => (r.ok ? (r.json() as Promise<SeriesAniListEntryDetailResponse>) : null))
      .then((data) => {
        if (!data || activeSeriesId !== currentSeriesIdRef.current) return;
        if (data.detail) {
          const detail = data.detail;
          // Merge into the cached copy (functional updater) so a remap that landed
          // while this fetch was in flight isn't clobbered.
          queryClient.setQueryData<AnimePayload>(queryKeys.anime(activeSeriesId, instance), (prev) => {
            if (!prev) return prev;
            const detailsById = new Map(prev.detailsById).set(entryId, detail);
            return { animeData: { ...prev.animeData, mapping: data.mapping }, detailsById };
          });
        } else {
          // The entry no longer exists server-side (pruned) — resync everything.
          void resyncAnimeMapping();
        }
      })
      .catch(() => {
        toast.error('Failed to load AniList season details');
      })
      .finally(() => {
        if (activeSeriesId === currentSeriesIdRef.current) setActiveDetailLoading(false);
      });
  }

  // Full refetch when the client's view of the mapping went stale.
  async function resyncAnimeMapping() {
    if (!series?.id) return;
    const activeSeriesId = seriesId;
    try {
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}/anime?full=1`);
      if (!res.ok) return;
      const data: SeriesAniListResponse = await res.json();
      if (activeSeriesId !== currentSeriesIdRef.current) return;
      setActiveAnimeTab(0);
      queryClient.setQueryData<AnimePayload>(queryKeys.anime(activeSeriesId, instance), (prev) => {
        const detailsById = new Map(prev?.detailsById ?? []);
        for (const detail of data.details) detailsById.set(detail.id, detail);
        return { animeData: data, detailsById };
      });
      setDrawerState({ key: `${activeSeriesId}|${instance ?? ''}`, details: data.details });
    } catch {
      // Best-effort resync.
    }
  }

  function handleAniListUpdated(next: SeriesAniListResponse) {
    setAnimeOverviewExpanded(false);
    setActiveAnimeTab(0);
    // Mutation responses carry the full detail set — merge into the cached map and
    // refresh the drawer's hydrated copy in one go. When a match now exists the
    // TMDB fallback queries auto-disable (animeTmdbFallback flips false), so there
    // is nothing to clear manually.
    queryClient.setQueryData<AnimePayload>(animeKey, (prev) => {
      const detailsById = new Map(prev?.detailsById ?? []);
      for (const detail of next.details) detailsById.set(detail.id, detail);
      return { animeData: next, detailsById };
    });
    setDrawerState({ key: drawerKey, details: next.details });
    toast.success(
      next.mapping.state === 'MANUAL_NONE'
        ? 'AniList mapping cleared'
        : 'AniList mapping updated'
    );
  }

  const animeMapping = animeData?.mapping ?? null;
  const animeEntries = animeMapping?.entries ?? [];
  const activeAnimeIdx = animeEntries.length ? Math.min(activeAnimeTab, animeEntries.length - 1) : 0;
  const activeAnimeEntryId = animeEntries[activeAnimeIdx]?.anilistMediaId ?? null;
  const animeDetail = activeAnimeEntryId != null ? animeDetailsById.get(activeAnimeEntryId) ?? null : null;
  useEffect(() => {
    activeAnimeEntryIdRef.current = activeAnimeEntryId;
  }, [activeAnimeEntryId]);
  // Base reference for short tab labels ("Season 2" instead of the full name).
  const primaryEntry = animeEntries[0];
  const animePrimaryTitle = primaryEntry
    ? animeDetailsById.get(primaryEntry.anilistMediaId)?.title ?? primaryEntry.titleSnapshot
    : null;
  // Drawer gets the hydrated full set; before hydration, whatever is loaded
  // (primary first) keeps suggestions/covers usable.
  const animeDetails = drawerDetails
    ?? animeEntries
      .map((entry) => animeDetailsById.get(entry.anilistMediaId))
      .filter((detail): detail is AniListDetailResponse => Boolean(detail));
  const nextAiringSeconds = animeDetail?.nextAiringEpisode
    ? Math.max(0, animeDetail.nextAiringEpisode.airingAt - Math.floor(animeNowMs / 1000))
    : null;

  return {
    animeData,
    animeDetailsById,
    animeLoading,
    animeMapping,
    animeEntries,
    activeAnimeIdx,
    animeDetail,
    animePrimaryTitle,
    animeDetails,
    activeDetailLoading,
    nextAiringSeconds,
    animeOverviewExpanded,
    setAnimeOverviewExpanded,
    expandedAnimeTabId,
    setExpandedAnimeTabId,
    showAniListRemap,
    setShowAniListRemap,
    selectAnimeTab,
    handleAniListUpdated,
  };
}

export type SeriesAnime = ReturnType<typeof useSeriesAnime>;
