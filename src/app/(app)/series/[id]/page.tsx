'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import DOMPurify from 'isomorphic-dompurify';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/layout/page-header';
import { AnimeHero } from '@/components/anime/anime-hero';
import { AnimeCharacterRail } from '@/components/anime/anime-character-rail';
import { AnimeRelationsSection } from '@/components/anime/anime-relations-section';
import { AnimeMediaRail } from '@/components/anime/anime-media-rail';
import { AniListRemapDrawer } from '@/components/anime/anilist-remap-drawer';
import { getImageUrl } from '@/components/media/media-card';
import { VirtualizedPersonRail } from '@/components/media/virtualized-person-rail';
import { DiscoverInfoRows } from '@/components/discover/discover-info-rows';
import {
  Bookmark, Bell, MoreHorizontal, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Loader2, Tv, Heart, Eye, Star, ChevronDown, ChevronUp, ChevronRight, ChevronLeft,
  Trophy, TrendingUp, FileEdit, Sparkles, TriangleAlert, FileStack, Check,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, parse } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, DiscoverTvFullDetail, DiscoverSeasonDetailResponse } from '@/types';
import type {
  AniListDetailResponse,
  SeriesAniListEntryDetailResponse,
  SeriesAniListResponse,
} from '@/types/anilist';
import { Skeleton } from '@/components/ui/skeleton';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
import { ApiError, arrMutationFetch, ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { episodesWithFileKey, tvSeasonKey } from '@/lib/series-query-cache';
import { useQualityProfiles, useRootFolders, useTags } from '@/lib/hooks/use-reference-data';
import { pollCommand } from '@/lib/arr-command';
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useExternalUrls, useExternalUrlResolver } from '@/lib/hooks/use-external-urls';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import { formatBytes } from '@/lib/format';
import { formatAniListRankingLabel, formatFuzzyDate } from '@/lib/anilist-helpers';
import { seasonTabLabel } from '@/lib/anilist-title-match';
import { AnilistStatusPanel } from '@/components/anime/anilist-status-panel';
import { WatchlistAddDialog } from '@/components/watchlist/watchlist-add-dialog';
import { ScheduledAlertDialog } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { AnimeTrailerRail } from '@/components/anime/anime-trailer-rail';
import { useCan, useMe } from '@/components/permission-provider';
import { useWatchLookup } from '@/components/jellyfin/watch-status-provider';
import { useSeriesEpisodeWatch } from '@/components/jellyfin/use-series-episode-watch';
import { EpisodeWatchIndicator } from '@/components/jellyfin/watch-status-indicator';
import { MarkWatchedMenuItem } from '@/components/jellyfin/mark-watched-button';
import { episodeKey, type EpisodeWatchStatus } from '@/types/watch-status';

interface SeriesCredits {
  cast: { id: number; name: string; profilePath: string | null; character: string; episodeCount?: number }[];
  crew: { id: number; name: string; profilePath: string | null; job: string }[];
}

// The anime query holds the mapping/primary detail (animeData) plus the lazily
// accumulated per-tab details (detailsById) in one cache entry — both survive
// back-nav via gcTime, mirroring the old snapshot's animeData + animeDetailsById.
interface AnimePayload {
  animeData: SeriesAniListResponse;
  detailsById: Map<number, AniListDetailResponse>;
}

const EMPTY_ANIME_DETAILS: Map<number, AniListDetailResponse> = new Map();

function formatCountdown(seconds: number): string {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  parts.push(`${mins}m`);
  return parts.join(' ');
}

function formatDateValue(value: string | null | undefined, includeTime = false): string | null {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? parse(value, 'yyyy-MM-dd', new Date())
    : new Date(value);
  if (!Number.isFinite(date.getTime())) return null;
  return format(date, includeTime ? "MMM d, yyyy 'at' h:mm a" : 'MMM d, yyyy');
}

const STATUS_COLORS: Record<string, string> = {
  CURRENT: 'bg-blue-500',
  PLANNING: 'bg-green-500',
  COMPLETED: 'bg-violet-500',
  PAUSED: 'bg-yellow-500',
  DROPPED: 'bg-red-500',
};

const STATUS_LABELS: Record<string, string> = {
  CURRENT: 'Current',
  PLANNING: 'Planning',
  COMPLETED: 'Completed',
  PAUSED: 'Paused',
  DROPPED: 'Dropped',
};

function formatAniListMappingState(state: SeriesAniListResponse['mapping']['state'] | null | undefined): string {
  if (state === 'MANUAL_MATCH') return 'Manual match';
  if (state === 'MANUAL_NONE') return 'Manually unmapped';
  if (state === 'AUTO_MATCH') return 'Auto matched';
  if (state === 'AUTO_UNMATCHED') return 'No confident match';
  return 'Not mapped';
}

function waitForElementScrollY(
  element: HTMLElement,
  targetScrollY: number,
  timeoutMs = 1200,
  pollMs = 50
): Promise<void> {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const tick = () => {
      const maxScroll = Math.max(0, element.scrollHeight - element.clientHeight);
      if (maxScroll >= targetScrollY || Date.now() - startedAt >= timeoutMs) {
        resolve();
        return;
      }
      window.setTimeout(tick, pollMs);
    };
    tick();
  });
}


export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const seriesId = Number(id);
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const detailViewKey: DetailViewKey = `series:${seriesId}`;
  const currentSeriesIdRef = useRef(seriesId);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);
  // The on-screen AniList entry — read by the background refresh interval.
  const activeAnimeEntryIdRef = useRef<number | null>(null);
  currentSeriesIdRef.current = seriesId;

  // Series + episodes: TanStack's gcTime gives instant back-nav paint without a
  // bespoke snapshot, and these are shared keys (queryKeys.detail / .episodes) so
  // a monitor change on the season or episode view reflects here and vice-versa.
  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', seriesId, instance),
    queryFn: jsonFetcher<SonarrSeries | null>(`/api/sonarr/${seriesId}`, instance),
    enabled: Number.isFinite(seriesId),
  });
  const series = seriesQuery.data ?? null;
  const episodesQuery = useQuery({
    queryKey: queryKeys.episodes(seriesId, instance),
    queryFn: jsonFetcher<SonarrEpisode[]>(`/api/sonarr/${seriesId}/episodes`, instance),
    enabled: Number.isFinite(seriesId),
    select: ensureArray,
  });
  const episodes = episodesQuery.data ?? [];
  const loading = seriesQuery.isLoading || episodesQuery.isLoading;
  const refreshing = seriesQuery.isFetching || episodesQuery.isFetching;

  const [showDelete, setShowDelete] = useState(false);
  const [showMonitorEdit, setShowMonitorEdit] = useState(false);
  const [showRenamePreview, setShowRenamePreview] = useState(false);
  const [monitorOption, setMonitorOption] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const externalUrls = useExternalUrls();
  const sonarrExternalUrl = useExternalUrlResolver()('SONARR', instance);
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [activeDetailLoading, setActiveDetailLoading] = useState(false);
  // Full detail set hydrated when the remap drawer opens (suggestions need every entry's relations).
  const [drawerDetails, setDrawerDetails] = useState<AniListDetailResponse[] | null>(null);
  const [animeOverviewExpanded, setAnimeOverviewExpanded] = useState(false);
  const [showAniListRemap, setShowAniListRemap] = useState(false);
  const [activeAnimeTab, setActiveAnimeTab] = useState(0);
  // Season chip expanded to its full name (mobile has no hover), keyed by anilistMediaId.
  const [expandedAnimeTabId, setExpandedAnimeTabId] = useState<number | null>(null);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showScheduleAlert, setShowScheduleAlert] = useState(false);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
  const [animeNowMs, setAnimeNowMs] = useState(() => Date.now());

  const canManageActivity = useCan('activity.manage');
  const canEditMonitoring = useCan('series.editMonitoring');
  const canEditTags = useCan('series.editTags');
  const canChangePath = useCan('series.changePath');
  const canAddSeries = useCan('series.add');
  const canDeleteSeries = useCan('series.delete');
  const canManageFiles = useCan('series.manageFiles');
  const canScheduleAlert = useCan('scheduledAlerts.edit');
  const canEditSeries = canEditMonitoring || canEditTags || canChangePath;
  // AniList mapping mutations are admin-only server-side — hide their triggers
  // from members so they don't open a drawer whose saves would 403.
  const isAdmin = useMe()?.role === 'admin';

  const MONITOR_OPTIONS = [
    { value: 'all', label: 'All Episodes' },
    { value: 'future', label: 'Future Episodes' },
    { value: 'missing', label: 'Missing Episodes' },
    { value: 'existing', label: 'Existing Episodes' },
    { value: 'recent', label: 'Recent Episodes' },
    { value: 'pilot', label: 'Pilot Episode' },
    { value: 'firstSeason', label: 'First Season' },
    { value: 'lastSeason', label: 'Last Season' },
    { value: 'monitorSpecials', label: 'Monitor Specials' },
    { value: 'unmonitorSpecials', label: 'Unmonitor Specials' },
    { value: 'none', label: 'None' },
  ];

  // Reference data — shared (and deduped) with the list / edit / add pages.
  const { data: qualityProfiles = [] } = useQualityProfiles('sonarr', instance);
  // The rootfolders route 403s without add/changePath, so skip the fetch (and
  // the Root Folder info row) for plain viewers instead of erroring.
  const { data: rootFolders = [] } = useRootFolders('sonarr', instance, canAddSeries || canChangePath);
  const { data: tags = [] } = useTags('sonarr', instance);

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

  // Anime with no AniList match (auto-unmatched or manually unmapped) fall back to
  // TMDB series-level enrichment like normal shows. Episode-level TMDB data stays
  // disabled for anime regardless — episode orders rarely line up with TMDB.
  const animeTmdbFallback = series?.seriesType === 'anime' && animeData !== null && animeData.mapping.entries.length === 0;
  const wantsTmdbEnrichment = !!series && (series.seriesType !== 'anime' || animeTmdbFallback);

  // Cast/crew + TMDB enrichment — only for non-anime (or the unmatched-anime fallback).
  const creditsQuery = useQuery({
    queryKey: queryKeys.credits('sonarr', seriesId, instance),
    queryFn: jsonFetcher<SeriesCredits>(`/api/sonarr/${seriesId}/credits`, instance),
    enabled: wantsTmdbEnrichment,
    staleTime: 5 * 60_000,
  });
  const credits = creditsQuery.data ?? { cast: [], crew: [] };
  const tmdbQuery = useQuery({
    queryKey: queryKeys.discoverDetail('tv', series?.tmdbId),
    queryFn: jsonFetcher<DiscoverTvFullDetail | null>(`/api/discover/tv/${series?.tmdbId}`),
    enabled: wantsTmdbEnrichment && !!series?.tmdbId,
    staleTime: 30 * 60_000,
  });
  const tmdbData = tmdbQuery.data ?? null;

  // Jellyfin watch status — series aggregate (shared map) + per-episode map (shared hook).
  const lookupWatch = useWatchLookup();
  const seriesWatch = lookupWatch({ kind: 'series', tvdbId: series?.tvdbId, tmdbId: series?.tmdbId, imdbId: series?.imdbId });
  const { episodes: episodeWatch } = useSeriesEpisodeWatch({ tvdbId: series?.tvdbId, tmdbId: series?.tmdbId, imdbId: series?.imdbId });
  // Bucket watched episodes by season once (keys are `S{season}E{episode}`),
  // so each season header is an O(1) lookup instead of re-scanning the whole map.
  const watchedBySeason = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const [key, ep] of Object.entries(episodeWatch)) {
      if (!ep.played) continue;
      const match = /^S(\d+)E/.exec(key);
      if (match) counts[Number(match[1])] = (counts[Number(match[1])] ?? 0) + 1;
    }
    return counts;
  }, [episodeWatch]);

  const getCurrentScrollY = useCallback(() => {
    const content = contentScrollRef.current;
    if (content) {
      const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
      if (maxScroll > 0 || content.scrollTop > 0) return content.scrollTop;
    }

    if (typeof window === 'undefined') return 0;
    return window.scrollY;
  }, []);

  // Reset scroll-restore guards and per-series UI state whenever the series /
  // instance changes (Next keeps this component mounted across param changes, so
  // this can't rely on a remount).
  useEffect(() => {
    scrollReadyRef.current = false;
    hasRestoredScrollRef.current = false;
    setExpandedSeasons(new Set());
    setDrawerDetails(null);
  }, [seriesId, instance]);

  useEffect(() => {
    if (loading || !series || hasRestoredScrollRef.current) return;
    const saved = getDetailViewState(detailViewKey);
    if (!saved || saved.scrollY <= 0) {
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
      return;
    }

    let cancelled = false;
    void (async () => {
      const content = contentScrollRef.current;

      if (content) {
        await waitForElementScrollY(content, saved.scrollY);
      } else {
        await waitForScrollY(saved.scrollY);
      }

      if (cancelled) return;
      if (content) {
        content.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      } else {
        window.scrollTo({ top: saved.scrollY, behavior: 'instant' });
      }
      hasRestoredScrollRef.current = true;
      scrollReadyRef.current = true;
    })();

    return () => {
      cancelled = true;
    };
  }, [detailViewKey, loading, series]);

  useEffect(() => {
    const persistScroll = () => {
      if (!scrollReadyRef.current) return;
      setDetailViewState(detailViewKey, { scrollY: getCurrentScrollY() });
    };

    let lastSaved = 0;
    const onScroll = () => {
      const now = Date.now();
      if (now - lastSaved < 150) return;
      lastSaved = now;
      persistScroll();
    };

    const content = contentScrollRef.current;
    window.addEventListener('scroll', onScroll, { passive: true });
    content?.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('pagehide', persistScroll);
    return () => {
      persistScroll();
      window.removeEventListener('scroll', onScroll);
      content?.removeEventListener('scroll', onScroll);
      window.removeEventListener('pagehide', persistScroll);
    };
  }, [detailViewKey, getCurrentScrollY, loading, series]);

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
  }, [series?.id, series?.seriesType, seriesId, instance, queryClient]);

  useEffect(() => {
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
        setDrawerDetails(data.details);
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
      setDrawerDetails(data.details);
    } catch {
      // Best-effort resync.
    }
  }

  // Toggle the expand state only — the per-season TMDB episode list is fetched
  // (and cached, so re-expand is instant) by the <ExpandedSeasonEpisodes> child.
  function toggleSeasonExpand(seasonNumber: number) {
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) next.delete(seasonNumber);
      else next.add(seasonNumber);
      return next;
    });
  }

  async function handleOpenInJellyfin() {
    if (!series || !externalUrls.JELLYFIN) return;
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
        popup.location.href = `${externalUrls.JELLYFIN}/web/index.html#!/details?id=${data.itemId}`;
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
    setDrawerDetails(next.details);
    toast.success(
      next.mapping.state === 'MANUAL_NONE'
        ? 'AniList mapping cleared'
        : 'AniList mapping updated'
    );
  }

  const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => b - a);

  async function handleSearchAll() {
    if (!series) return;
    setActionLoading('search');
    try {
      await arrMutationFetch(instance, '/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeriesSearch', seriesId: series.id }),
      });
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
      const monitorUpdate = {
        ...series,
        monitored: monitorOption !== 'none',
        seasons: series.seasons.map((s) => {
          switch (monitorOption) {
            case 'all':
              return { ...s, monitored: true };
            case 'future':
              return { ...s, monitored: true };
            case 'none':
              return { ...s, monitored: false };
            case 'firstSeason':
              return { ...s, monitored: s.seasonNumber === 1 };
            case 'lastSeason': {
              const maxSeason = Math.max(...series.seasons.filter((ss) => ss.seasonNumber > 0).map((ss) => ss.seasonNumber));
              return { ...s, monitored: s.seasonNumber === maxSeason };
            }
            case 'monitorSpecials':
              return { ...s, monitored: true };
            case 'unmonitorSpecials':
              return { ...s, monitored: s.seasonNumber !== 0 ? s.monitored : false };
            default:
              return { ...s, monitored: true };
          }
        }),
        addOptions: { monitor: monitorOption },
      };
      const updateRes = await arrMutationFetch(instance, `/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(monitorUpdate),
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
      await Promise.all([seriesQuery.refetch(), episodesQuery.refetch()]);
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
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}?deleteFiles=true`, { method: 'DELETE' });
      if (!res.ok) throw new Error(`Delete failed (${res.status})`);
      invalidateSeries(queryClient);
      queryClient.removeQueries({ queryKey: queryKeys.detail('sonarr', series.id, instance) });
      queryClient.removeQueries({ queryKey: queryKeys.episodes(series.id, instance) });
      queryClient.removeQueries({ queryKey: episodesWithFileKey(series.id, instance) });
      queryClient.removeQueries({ queryKey: queryKeys.anime(series.id, instance) });
      queryClient.removeQueries({ queryKey: queryKeys.credits('sonarr', series.id, instance) });
      toast.success('Series deleted');
      router.push('/series');
    } catch (e) { handleAuthError(e); toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  // Loading skeleton
  if (loading && !series) {
    return <><PageHeader title="Series" /><PageSpinner /></>;
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const poster = getImageUrl(series.images, 'poster', 'sonarr');
  const qualityProfile = qualityProfiles.find((qp) => qp.id === series.qualityProfileId);
  const seriesTags = tags.filter((t) => series.tags.includes(t.id));
  const rootFolder = rootFolders.find((rf) => series.path?.startsWith(rf.path));

  // Determine status badge
  const hasAllFiles = series.statistics
    ? series.statistics.episodeFileCount >= series.statistics.episodeCount && series.statistics.episodeCount > 0
    : false;
  const statusLabel = hasAllFiles ? 'DOWNLOADED' : series.status?.toUpperCase() || 'UNKNOWN';
  const statusColor = hasAllFiles
    ? 'bg-green-500/20 text-green-400'
    : series.status === 'continuing'
      ? 'bg-purple-500/20 text-purple-400'
      : 'bg-muted text-muted-foreground';

  // Next airing
  const nextAiring = series.nextAiring
    ? format(new Date(series.nextAiring), "MMM d, yyyy 'at' h:mm a")
    : null;
  const isAnimeSeries = series.seriesType === 'anime';
  const animeMapping = animeData?.mapping ?? null;
  const animeEntries = animeMapping?.entries ?? [];
  const activeAnimeIdx = animeEntries.length ? Math.min(activeAnimeTab, animeEntries.length - 1) : 0;
  const activeAnimeEntryId = animeEntries[activeAnimeIdx]?.anilistMediaId ?? null;
  const animeDetail = activeAnimeEntryId != null ? animeDetailsById.get(activeAnimeEntryId) ?? null : null;
  activeAnimeEntryIdRef.current = activeAnimeEntryId;
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
  const animeDescription = animeDetail?.description ? DOMPurify.sanitize(animeDetail.description) : '';
  const animeInfoRows: Array<{ label: string; value: string; valueNode?: ReactNode }> = [];
  if (animeDetail?.format) animeInfoRows.push({ label: 'Format', value: animeDetail.format.replace(/_/g, ' ') });
  if (animeDetail?.episodes != null) animeInfoRows.push({ label: 'Episodes', value: String(animeDetail.episodes) });
  if (animeDetail?.duration != null) animeInfoRows.push({ label: 'Episode Duration', value: `${animeDetail.duration} mins` });
  if (animeDetail?.status) animeInfoRows.push({ label: 'Status', value: animeDetail.status.charAt(0) + animeDetail.status.slice(1).toLowerCase().replace(/_/g, ' ') });
  const animeStartDate = formatFuzzyDate(animeDetail?.startDate ?? null);
  if (animeStartDate) animeInfoRows.push({ label: 'Start Date', value: animeStartDate });
  const animeEndDate = formatFuzzyDate(animeDetail?.endDate ?? null);
  if (animeEndDate) animeInfoRows.push({ label: 'End Date', value: animeEndDate });
  if (animeDetail?.season && animeDetail.seasonYear) {
    animeInfoRows.push({ label: 'Season', value: `${animeDetail.season.charAt(0)}${animeDetail.season.slice(1).toLowerCase()} ${animeDetail.seasonYear}` });
  }
  if (animeDetail?.averageScore != null) animeInfoRows.push({ label: 'Average Score', value: `${animeDetail.averageScore}%` });
  if (animeDetail?.meanScore != null) animeInfoRows.push({ label: 'Mean Score', value: `${animeDetail.meanScore}%` });
  if (animeDetail?.popularity != null) animeInfoRows.push({ label: 'Popularity', value: animeDetail.popularity.toLocaleString() });
  if (animeDetail?.favourites != null) animeInfoRows.push({ label: 'Favorites', value: animeDetail.favourites.toLocaleString() });
  const mainStudios = animeDetail?.studios.filter((studio) => studio.isMain) ?? [];
  if (mainStudios.length > 0) {
    animeInfoRows.push({
      label: 'Studios',
      value: mainStudios.map((studio) => studio.name).join(', '),
      valueNode: (
        <span>
          {mainStudios.map((studio, index) => (
            <span key={studio.id}>
              {index > 0 && ', '}
              <Link href={`/anime/studio/${studio.id}`} className="text-primary hover:underline">{studio.name}</Link>
            </span>
          ))}
        </span>
      ),
    });
  }
  const producers = animeDetail?.studios.filter((studio) => !studio.isMain) ?? [];
  if (producers.length > 0) {
    animeInfoRows.push({
      label: 'Producers',
      value: producers.map((studio) => studio.name).join(', '),
      valueNode: (
        <span>
          {producers.map((studio, index) => (
            <span key={studio.id}>
              {index > 0 && ', '}
              <Link href={`/anime/studio/${studio.id}`} className="text-primary hover:underline">{studio.name}</Link>
            </span>
          ))}
        </span>
      ),
    });
  }
  if (animeDetail?.source) {
    animeInfoRows.push({
      label: 'Source',
      value: animeDetail.source.replace(/_/g, ' ').split(' ').map((word) => word.charAt(0) + word.slice(1).toLowerCase()).join(' '),
    });
  }
  if (animeDetail?.hashtag) animeInfoRows.push({ label: 'Hashtag', value: animeDetail.hashtag });
  const animeAltTitles: { label: string; value: string }[] = [];
  if (animeDetail?.titleRomaji) animeAltTitles.push({ label: 'Romaji', value: animeDetail.titleRomaji });
  const animeEnglishTitle = animeDetail && animeDetail.title !== animeDetail.titleRomaji ? animeDetail.title : null;
  if (animeEnglishTitle && animeEnglishTitle !== animeDetail?.titleNative) {
    animeAltTitles.push({ label: 'English', value: animeEnglishTitle });
  }
  if (animeDetail?.titleNative) animeAltTitles.push({ label: 'Native', value: animeDetail.titleNative });
  if (animeDetail?.synonyms?.length) animeAltTitles.push({ label: 'Synonyms', value: animeDetail.synonyms.join(', ') });
  const animeTags = animeDetail?.tags.filter((tag) => !tag.isSpoiler) ?? [];
  const animeScoreDistribution = animeDetail?.scoreDistribution ?? [];
  const maxScoreAmount = animeScoreDistribution.length > 0
    ? Math.max(...animeScoreDistribution.map((entry) => entry.amount))
    : 0;
  const animeStatusDistribution = animeDetail?.statusDistribution ?? [];
  const totalStatusUsers = animeStatusDistribution.reduce((sum, entry) => sum + entry.amount, 0);
  const animeLinks: Array<{ label: string; url: string }> = animeDetail ? [
    { label: 'AniList', url: `https://anilist.co/anime/${animeDetail.id}` },
    ...(animeDetail.malId ? [{ label: 'MyAnimeList', url: `https://myanimelist.net/anime/${animeDetail.malId}` }] : []),
  ] : [];
  const openInAnimeHref = animeDetail?.id
    ? `/anime/${animeDetail.id}`
    : `/anime/explore?search=${encodeURIComponent(series.title)}`;
  const firstAired = formatDateValue(series.firstAired);
  const lastAired = formatDateValue(series.lastAired);
  const previousAiring = formatDateValue(series.previousAiring, true);
  const releaseDate = formatDateValue(tmdbData?.releaseDate ?? series.releaseDate ?? null) ?? animeStartDate;
  const alertReleaseDate =
    tmdbData?.releaseDate ?? series.releaseDate ?? series.firstAired ?? null;
  const originCountry = tmdbData?.originCountry?.filter(Boolean)?.join(', ') || null;
  const showType = tmdbData?.showType ?? (isAnimeSeries && animeDetail?.format ? animeDetail.format.replace(/_/g, ' ') : null);
  const runtimeValue = series.runtime > 0 ? `${series.runtime} min` : null;
  const tmdbNextEpisode = tmdbData?.nextEpisode
    ? [
      `S${tmdbData.nextEpisode.seasonNumber}E${tmdbData.nextEpisode.episodeNumber}`,
      tmdbData.nextEpisode.name,
      formatDateValue(tmdbData.nextEpisode.airDate),
    ].filter((part): part is string => Boolean(part)).join(' · ')
    : null;
  const animeNextEpisode = (() => {
    if (!animeDetail?.nextAiringEpisode) return null;
    const airDate = new Date(animeDetail.nextAiringEpisode.airingAt * 1000);
    const airDateText = Number.isFinite(airDate.getTime())
      ? format(airDate, "MMM d, yyyy 'at' h:mm a")
      : null;
    return [
      `Episode ${animeDetail.nextAiringEpisode.episode}`,
      airDateText,
    ].filter((part): part is string => Boolean(part)).join(' · ');
  })();
  const nextEpisode = tmdbNextEpisode || animeNextEpisode || nextAiring;

  const statisticsRows: Array<{ label: string; value: string }> = [];
  if (series.statistics) {
    statisticsRows.push({ label: 'Season Count', value: String(series.statistics.seasonCount) });
    statisticsRows.push({ label: 'Episode File Count', value: String(series.statistics.episodeFileCount) });
    statisticsRows.push({ label: 'Episode Count', value: String(series.statistics.episodeCount) });
    statisticsRows.push({ label: 'Total Episode Count', value: String(series.statistics.totalEpisodeCount) });
    if (series.statistics.sizeOnDisk > 0) {
      statisticsRows.push({ label: 'Size on Disk', value: formatBytes(series.statistics.sizeOnDisk) });
    }
    if (series.statistics.releaseGroups?.length) {
      statisticsRows.push({ label: 'Release Groups', value: series.statistics.releaseGroups.join(', ') });
    }
    if (series.statistics.percentOfEpisodes != null) {
      statisticsRows.push({ label: 'Percent of Episodes', value: `${series.statistics.percentOfEpisodes}%` });
    }
  }

  const seasonDetailRows = series.seasons
    .map((season) => {
      const stats = season.statistics;
      if (!stats) return null;
      const previousSeasonAiring = formatDateValue(stats.previousAiring, true);

      const parts = [
        `Files ${stats.episodeFileCount}/${stats.episodeCount}`,
        `Total ${stats.totalEpisodeCount}`,
        stats.sizeOnDisk > 0 ? `Size ${formatBytes(stats.sizeOnDisk)}` : null,
        stats.percentOfEpisodes != null ? `Coverage ${stats.percentOfEpisodes}%` : null,
        previousSeasonAiring ? `Previous ${previousSeasonAiring}` : null,
        stats.releaseGroups?.length ? `Groups ${stats.releaseGroups.join(', ')}` : null,
      ].filter((part): part is string => Boolean(part));

      if (parts.length === 0) return null;

      return {
        label: season.seasonNumber === 0 ? 'Season 0 (Specials)' : `Season ${season.seasonNumber}`,
        value: parts.join(' · '),
      };
    })
    .filter((row): row is { label: string; value: string } => row !== null);

  const infoRows: Array<{ label: string; value: string }> = [
    { label: 'Quality Profile', value: qualityProfile?.name || 'Unknown' },
    { label: 'Series Type', value: series.seriesType.charAt(0).toUpperCase() + series.seriesType.slice(1) },
    ...(showType ? [{ label: 'Show Type', value: showType }] : []),
    ...(series.certification ? [{ label: 'Certification', value: series.certification }] : []),
    ...(runtimeValue ? [{ label: 'Runtime', value: runtimeValue }] : []),
    ...(firstAired ? [{ label: 'First Aired', value: firstAired }] : []),
    ...(lastAired ? [{ label: 'Last Aired', value: lastAired }] : []),
    ...(previousAiring ? [{ label: 'Previous Airing', value: previousAiring }] : []),
    ...(releaseDate ? [{ label: 'Release Date', value: releaseDate }] : []),
    ...(originCountry ? [{ label: 'Origin Country', value: originCountry }] : []),
    ...(nextEpisode ? [{ label: 'Next Episode', value: nextEpisode }] : []),
    ...(seriesTags.length > 0 ? [{ label: 'Tags', value: seriesTags.map((t) => t.label).join(', ') }] : []),
    ...(series.path ? [{ label: 'Path', value: series.path }] : []),
    ...(rootFolder ? [{ label: 'Root Folder', value: rootFolder.path }] : []),
    { label: 'New Seasons', value: series.monitored ? 'Monitored' : 'Not Monitored' },
    { label: 'Season Folders', value: series.seasonFolder ? 'Yes' : 'No' },
    ...statisticsRows,
    {
      label: 'Added',
      value: series.added ? format(new Date(series.added), 'MMM d, yyyy') : 'Unknown',
    },
  ];

  return (
    <div
      className="flex flex-col min-h-0 animate-content-in -mx-2 md:-mx-6"
      onClickCapture={() => setDetailViewState(detailViewKey, { scrollY: getCurrentScrollY() })}
    >
      {/* Page Header */}
      <PageHeader
        title={series.title}
        onBack={() => router.push('/series')}
        rightContent={
          <div className="flex items-center gap-0.5">
            {refreshing && !loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
            )}
            {/* Bookmark / Monitor toggle — monitoring changes are admin-gated */}
            {canEditMonitoring && (
              <button
                onClick={handleToggleMonitored}
                disabled={actionLoading === 'monitor'}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
              >
                {actionLoading === 'monitor' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : series.monitored ? (
                  <Bookmark className="h-5 w-5 fill-current" />
                ) : (
                  <Bookmark className="h-5 w-5" />
                )}
              </button>
            )}

            {/* 3-dot dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                {canManageActivity && (
                  <DropdownMenuItem onClick={handleRefresh} disabled={actionLoading === 'refresh'}>
                    <RefreshCw className="h-4 w-4" />
                    Refresh
                  </DropdownMenuItem>
                )}
                {canManageActivity && (
                  <DropdownMenuItem onClick={handleSearchAll} disabled={actionLoading === 'search'}>
                    <Search className="h-4 w-4" />
                    Search Monitored
                  </DropdownMenuItem>
                )}
                {isAnimeSeries && (
                  <DropdownMenuItem asChild>
                    <Link href={openInAnimeHref}>
                      <Sparkles className="h-4 w-4" />
                      Open in Anime
                    </Link>
                  </DropdownMenuItem>
                )}
                {isAnimeSeries && isAdmin && (
                  <DropdownMenuItem onClick={() => setShowAniListRemap(true)}>
                    <Search className="h-4 w-4" />
                    Remap AniList
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                {series.tvdbId > 0 && (
                  <DropdownMenuItem asChild>
                    <a href={`https://trakt.tv/search/tvdb/${series.tvdbId}?id_type=show`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in Trakt
                    </a>
                  </DropdownMenuItem>
                )}
                {series.imdbId && (
                  <DropdownMenuItem asChild>
                    <a href={`https://www.imdb.com/title/${series.imdbId}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in IMDb
                    </a>
                  </DropdownMenuItem>
                )}
                {series.tvdbId > 0 && (
                  <DropdownMenuItem asChild>
                    <a href={`https://www.thetvdb.com/?id=${series.tvdbId}&tab=series`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                      Open in TVDB
                    </a>
                  </DropdownMenuItem>
                )}
                {sonarrExternalUrl && series.titleSlug && (
                  <DropdownMenuItem asChild>
                    <a href={`${sonarrExternalUrl}/series/${series.titleSlug}`} target="_blank" rel="noopener noreferrer">
                      <Tv className="h-4 w-4" />
                      Open in Sonarr
                    </a>
                  </DropdownMenuItem>
                )}
                {externalUrls.JELLYFIN && (series?.imdbId || series?.tvdbId) && (
                  <DropdownMenuItem onClick={handleOpenInJellyfin} disabled={jellyfinLoading}>
                    {jellyfinLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ExternalLink className="h-4 w-4" />}
                    Open in Jellyfin
                  </DropdownMenuItem>
                )}
                <MarkWatchedMenuItem status={seriesWatch} />
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowAddWatchlist(true)}>
                  <Bookmark className="h-4 w-4" />
                  Add to Watchlist…
                </DropdownMenuItem>
                {canScheduleAlert && (
                  <DropdownMenuItem onClick={() => setShowScheduleAlert(true)}>
                    <Bell className="h-4 w-4" />
                    Schedule alert…
                  </DropdownMenuItem>
                )}
                {canEditMonitoring && (
                  <DropdownMenuItem onClick={() => setShowMonitorEdit(true)}>
                    <Eye className="h-4 w-4" />
                    Monitor
                  </DropdownMenuItem>
                )}
                {canEditSeries && (
                  <DropdownMenuItem onClick={() => router.push(`/series/${id}/edit${instance ? `?instance=${instance}` : ''}`)}>
                    <Pencil className="h-4 w-4" />
                    Edit
                  </DropdownMenuItem>
                )}
                {canManageActivity && (
                  <DropdownMenuItem onClick={() => setShowRenamePreview(true)}>
                    <FileEdit className="h-4 w-4" />
                    Preview Rename
                  </DropdownMenuItem>
                )}
                {canManageFiles && (
                  <DropdownMenuItem
                    onClick={() =>
                      router.push(
                        `/series/${id}/manage?title=${encodeURIComponent(series.title)}${instance ? `&instance=${instance}` : ''}`
                      )
                    }
                  >
                    <FileStack className="h-4 w-4" />
                    Manage Episodes
                  </DropdownMenuItem>
                )}
                {canDeleteSeries && (
                  <DropdownMenuItem variant="destructive" onClick={() => setShowDelete(true)}>
                    <Trash2 className="h-4 w-4" />
                    Delete
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div ref={contentScrollRef} className="flex-1 overflow-y-auto px-2 md:p-6">
        {/* Hero: Backdrop or flat poster layout */}
        {isAnimeSeries && animeEntries.length > 1 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-1 pb-3 -mx-2 px-2 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {animeEntries.map((entry, index) => {
              const detail = animeDetailsById.get(entry.anilistMediaId);
              const fullTitle = detail?.title ?? entry.titleSnapshot ?? `AniList #${entry.anilistMediaId}`;
              const shortLabel = seasonTabLabel(fullTitle, animePrimaryTitle) ?? fullTitle;
              const expanded = expandedAnimeTabId === entry.anilistMediaId;
              const label = expanded
                ? detail?.seasonYear
                  ? `${fullTitle} · ${detail.seasonYear}`
                  : fullTitle
                : shortLabel;
              const active = index === activeAnimeIdx;
              return (
                <div
                  key={entry.anilistMediaId}
                  className={`flex shrink-0 items-center rounded-full text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[var(--hpr-amber)]/20 text-[var(--hpr-amber)]'
                      : 'bg-muted/30 text-muted-foreground'
                  }`}
                >
                  <button
                    onClick={() => selectAnimeTab(index)}
                    title={detail?.seasonYear ? `${fullTitle} · ${detail.seasonYear}` : fullTitle}
                    className={`truncate py-1.5 pl-3 ${expanded ? '' : 'max-w-[150px]'}`}
                  >
                    {label}
                  </button>
                  {/* Mobile has no hover — the chevron expands the chip to the full name. */}
                  <button
                    onClick={() => setExpandedAnimeTabId(expanded ? null : entry.anilistMediaId)}
                    aria-label={expanded ? 'Shrink season name' : 'Show full season name'}
                    className="py-1.5 pl-1 pr-2.5"
                  >
                    {expanded ? <ChevronLeft className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                </div>
              );
            })}
          </div>
        )}
        {isAnimeSeries && animeDetail ? (
          <AnimeHero
            title={animeDetail.title}
            bannerImage={animeDetail.bannerImage}
            coverImage={animeDetail.coverImage}
            format={animeDetail.format}
            averageScore={animeDetail.averageScore}
            episodes={animeDetail.episodes}
            status={animeDetail.status}
            season={animeDetail.season}
            seasonYear={animeDetail.seasonYear}
            studios={animeDetail.studios}
            bannerAction={(
              <Link
                href={openInAnimeHref}
                className="inline-flex items-center gap-1.5 rounded-full bg-background/55 backdrop-blur-md text-foreground px-3 py-1.5 text-[11px] font-medium hover:bg-background/70 transition-colors"
              >
                <Sparkles className="h-3.5 w-3.5" />
                <span className="tracking-widest uppercase">Open in Anime</span>
              </Link>
            )}
            nextAiringSeconds={formatCountdown(nextAiringSeconds ?? 0)}
            nextAiringEpisode={animeDetail.nextAiringEpisode}
          />
        ) : isAnimeSeries && animeEntries.length > 0 ? (
          // Active tab's detail is loading (lazy per-tab fetch) — hero-height placeholder.
          <div className="-mx-2 md:-mx-6">
            <div className="relative flex h-[220px] w-full items-center justify-center bg-muted/20">
              {activeDetailLoading || animeLoading ? (
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              ) : (
                <button
                  onClick={() => selectAnimeTab(activeAnimeIdx)}
                  className="rounded-full bg-background/55 px-3 py-1.5 text-xs text-muted-foreground backdrop-blur-md hover:bg-background/70"
                >
                  Couldn&apos;t load this season — tap to retry
                </button>
              )}
            </div>
            <div className="mt-4 space-y-2 px-2 md:px-6">
              <Skeleton className="h-5 w-2/3" />
              <Skeleton className="h-4 w-1/2" />
              <Skeleton className="h-4 w-1/3" />
            </div>
          </div>
        ) : tmdbData?.backdropPath ? (
          <div className='-mx-2 md:-mx-6'>
            <div className="relative w-full h-[220px] overflow-hidden bg-muted/40 ">
              <Image
                src={toCachedImageSrc(tmdbData.backdropPath, 'tmdb', { width: 1280 }) || tmdbData.backdropPath}
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
                priority
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
              {/* Watchlist + schedule alert icons — top right, mirrors discover hero */}
              <div className="absolute top-2 right-2 flex items-center gap-1.5">
                <button
                  type="button"
                  aria-label="Add to watchlist"
                  onClick={() => setShowAddWatchlist(true)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
                {canScheduleAlert && (
                  <button
                    type="button"
                    aria-label="Schedule alert"
                    onClick={() => setShowScheduleAlert(true)}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
                  >
                    <Bell className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            </div>
            <div className="relative -mt-[90px] px-2 md:px-6 flex gap-3.5">
              <div className="w-[100px] shrink-0">
                <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted shadow-lg ring-1 ring-border/20">
                  {poster ? (
                    <Image
                      src={poster}
                      alt={series.title}
                      fill
                      sizes="100px"
                      className="object-cover"
                      unoptimized={isProtectedApiImageSrc(poster)}
                    />
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                      <Tv className="h-8 w-8" />
                    </div>
                  )}
                </div>
              </div>
              <div className="flex-1 min-w-0 pt-[60px]">
                <span className={`inline-block text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusColor} mb-1.5`}>
                  {statusLabel}
                </span>
                <h1 className="text-lg font-bold leading-tight">{series.title}</h1>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {series.year}
                  {series.runtime > 0 && <> &middot; {series.runtime}m</>}
                  {series.certification && <> &middot; {series.certification}</>}
                </p>
                {series.ratings && series.ratings.value > 0 && (
                  <div className="flex items-center gap-1 mt-1.5">
                    <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                    <span className="text-sm font-medium">{Math.round(series.ratings.value * 10)}%</span>
                  </div>
                )}
              </div>
            </div>
            {tmdbData.tagline && (
              <p className="px-2 md:px-6 mt-3 text-sm italic text-muted-foreground">&ldquo;{tmdbData.tagline}&rdquo;</p>
            )}
          </div>
        ) : (
          <div className="flex gap-4 pt-3 pb-4">
            <div className="w-28 shrink-0">
              <div className="relative aspect-[2/3] rounded-lg overflow-hidden bg-muted">
                {poster ? (
                  <Image
                    src={poster}
                    alt={series.title}
                    width={112}
                    height={168}
                    className="w-full h-full object-cover"
                    unoptimized={isProtectedApiImageSrc(poster)}
                  />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-muted-foreground">
                    <Tv className="h-10 w-10" />
                  </div>
                )}
                <button
                  type="button"
                  aria-label="Add to watchlist"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setShowAddWatchlist(true);
                  }}
                  className="absolute top-1.5 right-1.5 inline-flex h-7 w-7 items-center justify-center rounded-full bg-background/55 backdrop-blur-md text-foreground hover:bg-background/80 shadow-md"
                >
                  <Bookmark className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="flex-1 min-w-0 pt-1">
              <span className={`inline-block text-[10px] font-bold tracking-wider px-1.5 py-0.5 rounded ${statusColor} mb-1.5`}>
                {statusLabel}
              </span>
              <h1 className="text-lg font-bold leading-tight">{series.title}</h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {series.year}
                {series.runtime > 0 && <> &middot; {series.runtime}m</>}
                {series.certification && <> &middot; {series.certification}</>}
              </p>
              {series.ratings && series.ratings.value > 0 && (
                <div className="flex items-center gap-1 mt-1.5">
                  <Heart className="h-3.5 w-3.5 text-red-500 fill-red-500" />
                  <span className="text-sm font-medium">{Math.round(series.ratings.value * 10)}%</span>
                </div>
              )}
            </div>
          </div>
        )}

        {isAnimeSeries && (
          <div className="pt-3 space-y-3">
            {/* Anilist update form */}
            {!animeLoading && animeDetail && <AnilistStatusPanel
              mediaId={animeDetail.id}
              mediaTitle={animeDetail.title}
              mediaType="ANIME"
              totalEpisodes={animeDetail.episodes}
            />}

            {/* AniList mapping management — above the trailer for discoverability.
                Amber call-to-action when no match is linked yet. Admin-only:
                the drawer's mutations 403 for members. */}
            {isAdmin && !animeLoading && animeData !== null && (
              animeEntries.length > 0 ? (
                <button
                  onClick={() => setShowAniListRemap(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors active:bg-muted/50"
                >
                  <Pencil className="h-3 w-3" />
                  AniList mapping{animeEntries.length > 1 ? ` · ${animeEntries.length} seasons` : ''}
                </button>
              ) : (
                <button
                  onClick={() => setShowAniListRemap(true)}
                  className="inline-flex items-center gap-1.5 rounded-full bg-[var(--hpr-amber)]/20 px-3 py-1.5 text-xs font-medium text-[var(--hpr-amber)] transition-colors active:bg-[var(--hpr-amber)]/30"
                >
                  <TriangleAlert className="h-3.5 w-3.5" />
                  Map to AniList
                </button>
              )
            )}

            {/* Trailer */}
            {!animeLoading && animeDetail && (
              <AnimeTrailerRail
                trailer={animeDetail.trailer}
                externalLinks={animeDetail.externalLinks}
                title={animeDetail.title}
              />
            )}
          </div>
        )}

        {/* Borderless metadata rows */}
        <div className="space-y-0">
          <div className="flex py-2 border-b border-border/30">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Status</span>
            <span className="text-sm capitalize">{series.status}</span>
          </div>
          {series.statistics && series.statistics.sizeOnDisk > 0 && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Size</span>
              <span className="text-sm">{formatBytes(series.statistics.sizeOnDisk)}</span>
            </div>
          )}
          {series.network && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Network</span>
              <span className="text-sm">{series.network}</span>
            </div>
          )}
          {series.genres && series.genres.length > 0 && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Genre</span>
              <span className="text-sm">{series.genres.join(', ')}</span>
            </div>
          )}
          {nextAiring && (
            <div className="flex py-2 border-b border-border/30">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Airing</span>
              <span className="text-sm">{nextAiring}</span>
            </div>
          )}
        </div>

        {/* Overview */}
        {series.overview && (
          <div className="pt-4 pb-2">
            <p
              className={`text-sm text-muted-foreground leading-relaxed ${!overviewExpanded ? 'line-clamp-3' : ''
                }`}
            >
              {series.overview}
            </p>
            {series.overview.length > 150 && (
              <button
                onClick={() => setOverviewExpanded(!overviewExpanded)}
                className="text-sm text-primary mt-1"
              >
                {overviewExpanded ? 'Show less' : 'More...'}
              </button>
            )}
          </div>
        )}

        {/* Created By */}
        {tmdbData && tmdbData.createdBy.length > 0 && (
          <div className="pt-2">
            <p className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created By</p>
            <div className="flex flex-wrap gap-x-3 gap-y-1">
              {tmdbData.createdBy.map((creator) => (
                <Link
                  key={creator.id}
                  href={`/discover/person/${creator.id}`}
                  className="text-sm font-medium text-primary"
                >
                  {creator.name}
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Seasons list */}
        <div className="mt-4">
          <h2 className="text-lg font-bold mb-2">Seasons</h2>
          <div>
            {seasonNumbers.map((sn) => {
              const seasonEps = episodes.filter((e) => e.seasonNumber === sn);
              const fileCount = seasonEps.filter((e) => e.hasFile).length;
              const total = seasonEps.length;
              const seasonData = series.seasons.find((s) => s.seasonNumber === sn);
              const isMonitored = seasonData?.monitored ?? true;
              const isAnime = series.seriesType === 'anime';
              const tmdbSeason = isAnime ? undefined : tmdbData?.seasons?.find((s) => s.seasonNumber === sn);
              const isExpanded = expandedSeasons.has(sn);

              return (
                <div key={sn} className="border-b border-border/50">
                  <div className="flex items-center py-3.5 gap-2">
                    {/* TMDB season poster */}
                    {tmdbSeason?.posterPath && (
                      <div className="relative w-[45px] h-[67px] rounded overflow-hidden shrink-0">
                        <Image
                          src={toCachedImageSrc(tmdbSeason.posterPath, 'tmdb') || tmdbSeason.posterPath}
                          alt=""
                          fill
                          sizes="45px"
                          className="object-cover"
                          unoptimized
                        />
                      </div>
                    )}
                    <Link href={`/series/${id}/season/${sn}${instance ? `?instance=${instance}` : ''}`} className="flex-1 min-w-0 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{sn === 0 ? 'Specials' : `Season ${sn}`}</span>
                          <span className="text-sm text-muted-foreground">{fileCount}/{total}</span>
                          {(watchedBySeason[sn] ?? 0) > 0 && (
                            <span className="inline-flex items-center gap-0.5 text-xs font-medium text-[var(--hpr-amber)]" title={`${watchedBySeason[sn]} watched`}>
                              <Check className="h-3 w-3" strokeWidth={3} />{watchedBySeason[sn]}
                            </span>
                          )}
                        </div>
                        {tmdbSeason && tmdbSeason.voteAverage > 0 && (
                          <div className="flex items-center gap-1 mt-0.5">
                            <Star className="h-3 w-3 fill-yellow-400 text-yellow-400" />
                            <span className="text-xs text-muted-foreground">{tmdbSeason.voteAverage.toFixed(1)}</span>
                          </div>
                        )}
                        {tmdbSeason?.overview && (
                          <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{tmdbSeason.overview}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                    {/* Expand/collapse for TMDB episodes (not for anime) */}
                    {tmdbData && !isAnime && (
                      <button
                        onClick={() => toggleSeasonExpand(sn)}
                        className="min-w-[36px] min-h-[44px] flex items-center justify-center"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>
                    )}
                    {/* Monitor toggle — admin-gated */}
                    {canEditMonitoring && (
                      <button
                        onClick={() => handleToggleSeasonMonitor(sn, !isMonitored)}
                        className="min-w-[36px] min-h-[44px] flex items-center justify-center"
                      >
                        {isMonitored ? (
                          <Bookmark className="h-5 w-5 fill-current text-foreground" />
                        ) : (
                          <Bookmark className="h-5 w-5 text-muted-foreground" />
                        )}
                      </button>
                    )}
                  </div>
                  {/* Expanded episode cards */}
                  {isExpanded && series.tmdbId && (
                    <ExpandedSeasonEpisodes
                      tmdbId={series.tmdbId}
                      seasonNumber={sn}
                      seasonEps={seasonEps}
                      seriesRouteId={String(id)}
                      instance={instance}
                      episodeWatch={episodeWatch}
                    />
                  )}
                </div>
              );
            })}
          </div>
        </div>

        {/* Information section */}
        <div className="mt-6">
          <h2 className="text-lg font-bold mb-2">Information</h2>
          <div className="space-y-0">
            {infoRows.map((row) => (
              <div key={row.label} className="flex justify-between py-2.5 border-b border-border/30 items-start">
                <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
                <span className="text-sm text-right ml-4 max-w-[60%] break-words">{row.value}</span>
              </div>
            ))}
            {seasonDetailRows.length > 0 && (
              <>
                <div className="pt-3 pb-1 text-xs uppercase tracking-wider text-muted-foreground">Season Details</div>
                {seasonDetailRows.map((row) => (
                  <div key={row.label} className="flex justify-between py-2.5 border-b border-border/30 items-start">
                    <span className="text-sm text-muted-foreground shrink-0">{row.label}</span>
                    <span className="text-sm text-right ml-4 max-w-[60%] break-words">{row.value}</span>
                  </div>
                ))}
              </>
            )}
            {isAnimeSeries && isAdmin && (
              <button
                onClick={() => setShowAniListRemap(true)}
                className="flex justify-between items-center w-full py-2.5 border-b border-border/30 -mx-2 px-2 rounded active:bg-muted/30"
              >
                <span className="text-sm text-muted-foreground">AniList</span>
                <span className="flex items-center gap-2 text-sm text-right">
                  {formatAniListMappingState(animeMapping?.state)}
                  {animeEntries.length > 1 ? ` · ${animeEntries.length} seasons` : ''}
                  {animeMapping?.state === 'MANUAL_MATCH' ? (
                    <Badge className="bg-green-600/90 text-foreground text-[10px] px-1.5 py-0">Manual</Badge>
                  ) : animeMapping?.state === 'AUTO_MATCH' ? (
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">Auto</Badge>
                  ) : null}
                  <Pencil className="h-3 w-3 text-muted-foreground" />
                </span>
              </button>
            )}
          </div>
        </div>

        {/* AniList sections when matched; unmatched anime fall through to the
            TMDB enrichment branch (series-level only — episode list stays Sonarr-only) */}
        {isAnimeSeries && animeDetail ? (
          <div className="space-y-5 mt-2">
            {animeDescription && (
              <div>
                <h2 className="text-base font-semibold mb-1">Synopsis</h2>
                <div
                  className={`text-sm text-muted-foreground leading-relaxed [&_i]:italic [&_br]:mb-2 ${animeOverviewExpanded ? '' : 'line-clamp-5'}`}
                  dangerouslySetInnerHTML={{ __html: animeDescription }}
                />
                {animeDescription.length > 200 && (
                  <button
                    onClick={() => setAnimeOverviewExpanded(!animeOverviewExpanded)}
                    className="text-xs text-primary mt-1 font-medium"
                  >
                    {animeOverviewExpanded ? 'Show less' : 'Read more'}
                  </button>
                )}
              </div>
            )}

            <div>
              <DiscoverInfoRows title="AniList Information" rows={animeInfoRows} />
            </div>

            {animeAltTitles.length > 0 && (
              <div>
                <h2 className="text-base font-semibold mb-2">Alternative Titles</h2>
                <div>
                  {animeAltTitles.map((title) => (
                    <div
                      key={title.label}
                      className="flex justify-between items-start py-2.5 border-b border-border/40 last:border-b-0"
                    >
                      <span className="text-sm text-muted-foreground shrink-0">{title.label}</span>
                      <span className="text-sm text-right ml-4">{title.value}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {(animeDetail?.genres.length || animeTags.length > 0) && (
              <div>
                <h2 className="text-base font-semibold mb-2">Genres & Tags</h2>
                <div className="flex flex-wrap gap-1.5">
                  {(animeDetail?.genres ?? []).map((genre) => (
                    <Badge key={genre} variant="secondary" className="text-xs">
                      {genre}
                    </Badge>
                  ))}
                  {animeTags.slice(0, 15).map((tag) => (
                    <Badge key={tag.name} variant="outline" className="text-xs">
                      {tag.name}
                      <span className="ml-1 text-muted-foreground">{tag.rank}%</span>
                    </Badge>
                  ))}
                </div>
              </div>
            )}

            {animeDetail && <div><AnimeCharacterRail characters={animeDetail.characters} /></div>}

            {animeDetail?.staff.length ? (
              <div>
                <h2 className="text-base font-semibold mb-2">Staff</h2>
                <div className="grid grid-cols-2 gap-2">
                  {animeDetail.staff.map((person, index) => {
                    const staffImgSrc = person.image
                      ? toCachedImageSrc(person.image, 'anilist') || person.image
                      : null;

                    return (
                      <Link
                        key={`${person.id}-${person.role}-${index}`}
                        href={`/anime/staff/${person.id}`}
                        className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 p-2 hover:border-primary/40 transition-colors"
                      >
                        <div className="relative w-10 h-10 rounded-full overflow-hidden bg-muted shrink-0">
                          {staffImgSrc ? (
                            <Image
                              src={staffImgSrc}
                              alt={person.name}
                              fill
                              sizes="40px"
                              className="object-cover"
                              unoptimized={isProtectedApiImageSrc(staffImgSrc)}
                            />
                          ) : (
                            <div className="absolute inset-0 flex items-center justify-center text-muted-foreground text-[10px]">
                              ?
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">{person.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{person.role}</p>
                        </div>
                      </Link>
                    );
                  })}
                </div>
              </div>
            ) : null}

            {animeDetail?.rankings.length ? (
              <div>
                <h2 className="text-base font-semibold mb-2">Rankings</h2>
                <div className="space-y-1.5">
                  {animeDetail.rankings.map((ranking) => (
                    <div
                      key={ranking.id}
                      className="flex items-center gap-2 rounded-lg border border-border/30 bg-muted/20 px-3 py-2"
                    >
                      {ranking.type === 'RATED' ? (
                        <Trophy className="h-3.5 w-3.5 text-yellow-500 shrink-0" />
                      ) : (
                        <TrendingUp className="h-3.5 w-3.5 text-blue-400 shrink-0" />
                      )}
                      <span className="text-sm">
                        <span className="font-semibold">#{ranking.rank}</span> {formatAniListRankingLabel(ranking)}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}

            {animeStatusDistribution.length > 0 && (
              <div>
                <h2 className="text-base font-semibold mb-2">Status Distribution</h2>
                {totalStatusUsers > 0 && (
                  <div className="flex h-3 rounded-full overflow-hidden mb-3">
                    {animeStatusDistribution.map((entry) => (
                      <div
                        key={entry.status}
                        className={STATUS_COLORS[entry.status] || 'bg-gray-500'}
                        style={{ width: `${(entry.amount / totalStatusUsers) * 100}%` }}
                      />
                    ))}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2">
                  {animeStatusDistribution.map((entry) => (
                    <div key={entry.status} className="flex items-center gap-2">
                      <div className={`w-2.5 h-2.5 rounded-full shrink-0 ${STATUS_COLORS[entry.status] || 'bg-gray-500'}`} />
                      <div className="text-sm">
                        <span className="text-muted-foreground">{STATUS_LABELS[entry.status] || entry.status}</span>
                        <span className="ml-1.5 font-medium">{entry.amount.toLocaleString()}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {animeScoreDistribution.length > 0 && maxScoreAmount > 0 && (
              <div>
                <h2 className="text-base font-semibold mb-2">Score Distribution</h2>
                <div className="flex items-end gap-1 h-28">
                  {[...animeScoreDistribution]
                    .sort((a, b) => a.score - b.score)
                    .map((entry) => {
                      const height = (entry.amount / maxScoreAmount) * 100;
                      const barColor = entry.score >= 70
                        ? 'bg-green-500'
                        : entry.score >= 50
                          ? 'bg-yellow-500'
                          : 'bg-red-500';

                      return (
                        <div key={entry.score} className="flex-1 flex flex-col items-center gap-1">
                          <span className="text-[10px] text-muted-foreground">{entry.amount > 0 ? entry.amount.toLocaleString() : ''}</span>
                          <div className="w-full flex items-end" style={{ height: '80px' }}>
                            <div
                              className={`w-full rounded-t-sm ${barColor}`}
                              style={{ height: `${Math.max(height, 2)}%` }}
                            />
                          </div>
                          <span className="text-[10px] text-muted-foreground">{entry.score}</span>
                        </div>
                      );
                    })}
                </div>
              </div>
            )}

            {animeDetail && <div><AnimeRelationsSection relations={animeDetail.relations} /></div>}
            {animeDetail && <div className='md:px-4'><AnimeMediaRail title="Recommendations" items={animeDetail.recommendations} /></div>}

            {(animeLinks.length > 0 || (externalUrls.JELLYFIN && (series.imdbId || series.tvdbId))) && (
              <div>
                <h2 className="text-base font-semibold mb-2">External Links</h2>
                <div className="flex flex-wrap gap-2">
                  {externalUrls.JELLYFIN && (series.imdbId || series.tvdbId) && (
                    <button
                      onClick={handleOpenInJellyfin}
                      disabled={jellyfinLoading}
                      className="inline-flex items-center gap-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-1.5 text-sm text-primary hover:bg-muted/50 transition-colors disabled:opacity-50"
                    >
                      {jellyfinLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
                      Open in Jellyfin
                    </button>
                  )}
                  {animeLinks.map((link) => (
                    <a
                      key={link.url}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-1.5 text-sm text-primary hover:bg-muted/50 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.label}
                    </a>
                  ))}
                  {animeDetail && animeDetail.externalLinks && animeDetail.externalLinks?.length > 0 && animeDetail.externalLinks.filter((link) => link.url).map((link) => (
                    <a
                      key={link.id}
                      href={link.url!}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-lg border border-border/30 bg-muted/30 px-3 py-1.5 text-sm text-primary hover:bg-muted/50 transition-colors"
                    >
                      <ExternalLink className="h-3 w-3" />
                      {link.site}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            {/* Cast & Crew */}
            {credits.cast.length > 0 && (
              <div className="mt-4">
                <VirtualizedPersonRail
                  title="Cast"
                  titleTextClassName="text-lg font-bold"
                  headerClassName="px-2 mb-2"
                  viewAllHref={`/series/${seriesId}/credits?type=cast${instance ? `&instance=${instance}` : ''}`}
                  items={credits.cast.map((person) => ({
                    id: person.id,
                    name: person.name,
                    imagePath: person.profilePath,
                    subtitle: `${person.character}${person.episodeCount ? ` · ${person.episodeCount} ep` : ''}`,
                    keySuffix: `cast-${person.character}`,
                  }))}
                  cacheService="tmdb"
                />
              </div>
            )}
            {credits.crew.length > 0 && (
              <div className="mt-4">
                <VirtualizedPersonRail
                  title="Crew"
                  titleTextClassName="text-lg font-bold"
                  headerClassName="px-2 mb-2"
                  viewAllHref={`/series/${seriesId}/credits?type=crew${instance ? `&instance=${instance}` : ''}`}
                  items={credits.crew.map((person) => ({
                    id: person.id,
                    name: person.name,
                    imagePath: person.profilePath,
                    subtitle: person.job,
                    keySuffix: `crew-${person.job}`,
                  }))}
                  cacheService="tmdb"
                />
              </div>
            )}

            {/* TMDB Enrichment Sections */}
            {tmdbData && (
              <div className="space-y-6 mt-6">
                {tmdbData.videos.length > 0 && (
                  <DiscoverVideoRail title="Videos" videos={tmdbData.videos} />
                )}

                {tmdbData.recommendations.length > 0 && (
                  <DiscoverMediaRail title="Recommendations" items={tmdbData.recommendations} />
                )}

                {tmdbData.similar.length > 0 && (
                  <DiscoverMediaRail title="Similar Shows" items={tmdbData.similar} />
                )}

                {tmdbData.watchProviders && (
                  <DiscoverWatchProvidersSection providers={tmdbData.watchProviders} />
                )}

                {tmdbData.networks.length > 0 && (
                  <div>
                    <h2 className="text-base font-semibold mb-2">Networks</h2>
                    <div className="flex gap-3 flex-wrap">
                      {tmdbData.networks.map((network) => {
                        const logoSrc = network.logoPath
                          ? toCachedImageSrc(
                            network.logoPath.startsWith('http') ? network.logoPath : `https://image.tmdb.org/t/p/w185${network.logoPath}`,
                            'tmdb'
                          )
                          : null;
                        return (
                          <Link
                            key={network.id}
                            href={`/discover?networks=${network.id}&contentType=show`}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30"
                          >
                            {logoSrc && (
                              <div className="relative h-5 w-8">
                                <Image
                                  src={logoSrc}
                                  alt={network.name}
                                  fill
                                  sizes="32px"
                                  className="object-contain"
                                  unoptimized={isProtectedApiImageSrc(logoSrc)}
                                />
                              </div>
                            )}
                            <span className="text-xs font-medium">{network.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                {tmdbData.productionCompanies.length > 0 && (
                  <div>
                    <h2 className="text-base font-semibold mb-2">Production</h2>
                    <div className="flex gap-3 flex-wrap">
                      {tmdbData.productionCompanies.map((company) => {
                        const logoSrc = company.logoPath
                          ? toCachedImageSrc(
                            company.logoPath.startsWith('http') ? company.logoPath : `https://image.tmdb.org/t/p/w185${company.logoPath}`,
                            'tmdb'
                          )
                          : null;
                        return (
                          <Link
                            key={company.id}
                            href={`/discover?companies=${company.id}&contentType=show`}
                            className="flex items-center gap-2 px-3 py-1.5 rounded-full border border-border/50 bg-accent/30"
                          >
                            {logoSrc && (
                              <div className="relative h-5 w-8">
                                <Image
                                  src={logoSrc}
                                  alt={company.name}
                                  fill
                                  sizes="32px"
                                  className="object-contain"
                                  unoptimized={isProtectedApiImageSrc(logoSrc)}
                                />
                              </div>
                            )}
                            <span className="text-xs font-medium">{company.name}</span>
                          </Link>
                        );
                      })}
                    </div>
                  </div>
                )}

                <div className="pb-2" />
              </div>
            )}
          </>
        )}
      </div>

      <AniListRemapDrawer
        open={showAniListRemap}
        onOpenChange={setShowAniListRemap}
        seriesId={series.id}
        seriesTitle={series.title}
        instanceId={instance}
        mapping={animeMapping}
        details={animeDetails}
        onUpdated={handleAniListUpdated}
      />

      <WatchlistAddDialog
        open={showAddWatchlist}
        onOpenChange={setShowAddWatchlist}
        draft={{
          source: 'SONARR',
          externalId: String(series.id),
          mediaType: 'series',
          title: series.title,
          year: series.year ?? null,
          posterUrl:
            series.images?.find((i) => i.coverType === 'poster')?.remoteUrl ??
            series.images?.find((i) => i.coverType === 'poster')?.url ??
            null,
          overview: series.overview ?? null,
        }}
      />

      {canScheduleAlert && (
        <ScheduledAlertDialog
          open={showScheduleAlert}
          onOpenChange={setShowScheduleAlert}
          draft={{
            source: 'SONARR',
            externalId: String(series.id),
            mediaType: 'series',
            title: series.title,
            year: series.year ?? null,
            posterUrl:
              series.images?.find((i) => i.coverType === 'poster')?.remoteUrl ??
              series.images?.find((i) => i.coverType === 'poster')?.url ??
              null,
            overview: series.overview ?? null,
            instanceId: instance ?? null,
            href: `/series/${series.id}${instance ? `?instance=${instance}` : ''}`,
            releaseDate: alertReleaseDate,
          }}
        />
      )}

      {/* Monitor edit drawer */}
      <Drawer open={showMonitorEdit} onOpenChange={setShowMonitorEdit}>
        <DrawerContent>
          <DrawerHeader className="text-center">
            <DrawerTitle>Monitor</DrawerTitle>
            <DrawerDescription>
              Choose which episodes to monitor for {series.title}.
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <div className="grouped-section">
              <div className="grouped-section-content">
                {MONITOR_OPTIONS.map((option) => (
                  <button
                    key={option.value}
                    onClick={() => setMonitorOption(option.value)}
                    className={`grouped-row w-full text-left active:bg-foreground/5 transition-colors ${monitorOption === option.value ? 'text-primary' : ''
                      }`}
                  >
                    <span className="text-sm">{option.label}</span>
                    {monitorOption === option.value && (
                      <span className="text-primary text-sm font-medium">&#10003;</span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <DrawerFooter>
            <Button
              onClick={handleApplyMonitor}
              disabled={!monitorOption || actionLoading === 'applyMonitor'}
              className="w-full"
            >
              {actionLoading === 'applyMonitor' && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Apply
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Delete confirmation drawer */}
      <Drawer open={showDelete} onOpenChange={setShowDelete}>
        <DrawerContent>
          <DrawerHeader className="text-center">
            <DrawerTitle>Delete {series.title}?</DrawerTitle>
            <DrawerDescription>
              This will remove the series from Sonarr and delete all files from disk. This action cannot be undone.
            </DrawerDescription>
          </DrawerHeader>
          <DrawerFooter>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="w-full">
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete Series & Files
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      <RenamePreviewDialog
        open={showRenamePreview}
        onOpenChange={setShowRenamePreview}
        service="sonarr"
        mediaId={series.id}
        mediaTitle={series.title}
        instanceId={instance}
      />
    </div>
  );
}

// TMDB episode list for an expanded (non-anime) season. Mounted only while the
// season is expanded; its useQuery caches per-(tmdbId, season) so re-expanding —
// or navigating to the season page (which shares tvSeasonKey) — is an instant
// cache hit instead of a refetch.
function ExpandedSeasonEpisodes({
  tmdbId,
  seasonNumber,
  seasonEps,
  seriesRouteId,
  instance,
  episodeWatch,
}: {
  tmdbId: number;
  seasonNumber: number;
  seasonEps: SonarrEpisode[];
  seriesRouteId: string;
  instance?: string;
  episodeWatch: Record<string, EpisodeWatchStatus>;
}) {
  const { data: epData, isError: epError } = useQuery({
    queryKey: tvSeasonKey(tmdbId, seasonNumber),
    queryFn: jsonFetcher<DiscoverSeasonDetailResponse>(`/api/discover/tv/${tmdbId}/season/${seasonNumber}`),
    staleTime: 30 * 60_000,
  });

  return (
    <div className="pb-3 pl-2">
      {epData ? (
        (epData.episodes ?? []).map((ep) => {
          const sonarrEp = seasonEps.find((e) => e.episodeNumber === ep.episodeNumber);
          const episodeHref = sonarrEp
            ? `/series/${seriesRouteId}/season/${seasonNumber}/episode/${sonarrEp.id}${instance ? `?instance=${instance}` : ''}`
            : null;

          const content = (
            <>
              {ep.stillPath && (
                <div className="relative w-[90px] h-[50px] rounded overflow-hidden shrink-0 bg-muted">
                  <Image
                    src={toCachedImageSrc(ep.stillPath, 'tmdb') || ep.stillPath}
                    alt=""
                    fill
                    sizes="90px"
                    className="object-cover"
                    unoptimized
                  />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <p className="text-sm font-medium line-clamp-1">E{ep.episodeNumber} &middot; {ep.name}</p>
                  {sonarrEp?.hasFile && (
                    <div className="h-2 w-2 rounded-full bg-green-500 shrink-0" title="Downloaded" />
                  )}
                  <span className="ml-auto shrink-0 pl-2">
                    <EpisodeWatchIndicator status={episodeWatch[episodeKey(seasonNumber, ep.episodeNumber)]} />
                  </span>
                </div>
                <div className="flex items-center gap-2 text-xs text-muted-foreground mt-0.5">
                  {ep.airDate && <span>{format(new Date(ep.airDate), 'MMM d, yyyy')}</span>}
                  {ep.runtime && <span>{ep.runtime}m</span>}
                  {ep.voteAverage > 0 && (
                    <span className="inline-flex items-center gap-0.5">
                      <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                      {ep.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
                {ep.overview && <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{ep.overview}</p>}
              </div>
              {episodeHref && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0 self-center" />}
            </>
          );

          return episodeHref ? (
            <Link
              key={ep.id}
              href={episodeHref}
              className="flex gap-3 py-2 border-t border-border/20 active:bg-muted/50 transition-colors"
            >
              {content}
            </Link>
          ) : (
            <div
              key={ep.id}
              className="flex gap-3 py-2 border-t border-border/20"
            >
              {content}
            </div>
          );
        })
      ) : epError ? (
        <div className="py-4 text-sm text-muted-foreground">Failed to load episodes.</div>
      ) : (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Loading episodes...
        </div>
      )}
    </div>
  );
}
