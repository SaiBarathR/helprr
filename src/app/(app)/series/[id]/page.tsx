'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import Image from 'next/image';
import DOMPurify from 'isomorphic-dompurify';
import { useParams, useRouter } from 'next/navigation';
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
  Bookmark, MoreHorizontal, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Loader2, Tv, Heart, Eye, Star, ChevronDown, ChevronUp, ChevronRight,
  Trophy, TrendingUp, FileEdit, Sparkles,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, parse } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, QualityProfile, RootFolder, Tag, DiscoverTvFullDetail, DiscoverSeasonDetailResponse } from '@/types';
import type { SeriesAniListResponse } from '@/types/anilist';
import {
  getSeriesDetailSnapshot,
  patchSeasonAcrossSnapshots,
  setSeriesDetailSnapshot,
  clearSeriesDetailSnapshot,
} from '@/lib/series-route-cache';
import { invalidateListData } from '@/lib/media-list-cache';
import { pollCommand } from '@/lib/arr-command';
import {
  getDetailViewState,
  setDetailViewState,
  waitForScrollY,
  type DetailViewKey,
} from '@/lib/detail-view-state';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import { formatBytes } from '@/lib/format';
import { formatAniListRankingLabel, formatFuzzyDate } from '@/lib/anilist-helpers';
import { AnilistStatusPanel } from '@/components/anime/anilist-status-panel';
import { WatchlistAddDialog } from '@/components/watchlist/watchlist-add-dialog';
import { AnimeTrailerRail } from '@/components/anime/anime-trailer-rail';
import { useCan } from '@/components/permission-provider';

interface SeriesCredits {
  cast: { id: number; name: string; profilePath: string | null; character: string; episodeCount?: number }[];
  crew: { id: number; name: string; profilePath: string | null; job: string }[];
}

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
  const initialSnapshot = Number.isFinite(seriesId) ? getSeriesDetailSnapshot(seriesId) : null;
  const detailViewKey: DetailViewKey = `series:${seriesId}`;
  const currentSeriesIdRef = useRef(seriesId);
  const contentScrollRef = useRef<HTMLDivElement>(null);
  const scrollReadyRef = useRef(false);
  const hasRestoredScrollRef = useRef(false);
  currentSeriesIdRef.current = seriesId;
  const [series, setSeries] = useState<SonarrSeries | null>(() => initialSnapshot?.series ?? null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>(() => initialSnapshot?.episodes ?? []);
  const [loading, setLoading] = useState(() => !initialSnapshot);
  const [refreshing, setRefreshing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showMonitorEdit, setShowMonitorEdit] = useState(false);
  const [showRenamePreview, setShowRenamePreview] = useState(false);
  const [monitorOption, setMonitorOption] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const externalUrls = useExternalUrls();
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [credits, setCredits] = useState<SeriesCredits>(() => initialSnapshot?.credits ?? { cast: [], crew: [] });
  const [tmdbData, setTmdbData] = useState<DiscoverTvFullDetail | null>(() => initialSnapshot?.tmdbData ?? null);
  const [animeData, setAnimeData] = useState<SeriesAniListResponse | null>(() => initialSnapshot?.animeData ?? null);
  const [animeLoading, setAnimeLoading] = useState(false);
  const [animeOverviewExpanded, setAnimeOverviewExpanded] = useState(false);
  const [showAniListRemap, setShowAniListRemap] = useState(false);
  const [activeAnimeTab, setActiveAnimeTab] = useState(0);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
  const [seasonEpisodes, setSeasonEpisodes] = useState<Map<number, DiscoverSeasonDetailResponse>>(
    () => initialSnapshot?.seasonEpisodes ?? new Map()
  );
  const [animeNowMs, setAnimeNowMs] = useState(() => Date.now());

  const canManageActivity = useCan('activity.manage');
  const canEditMonitoring = useCan('series.editMonitoring');
  const canEditTags = useCan('series.editTags');
  const canChangePath = useCan('series.changePath');
  const canDeleteSeries = useCan('series.delete');
  const canEditSeries = canEditMonitoring || canEditTags || canChangePath;

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

  // Reference data
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>(
    () => initialSnapshot?.qualityProfiles ?? []
  );
  const [rootFolders, setRootFolders] = useState<RootFolder[]>(
    () => initialSnapshot?.rootFolders ?? []
  );
  const [tags, setTags] = useState<Tag[]>(() => initialSnapshot?.tags ?? []);

  const getCurrentScrollY = useCallback(() => {
    const content = contentScrollRef.current;
    if (content) {
      const maxScroll = Math.max(0, content.scrollHeight - content.clientHeight);
      if (maxScroll > 0 || content.scrollTop > 0) return content.scrollTop;
    }

    if (typeof window === 'undefined') return 0;
    return window.scrollY;
  }, []);

  const persistSeriesSnapshot = useCallback((next: {
    series?: SonarrSeries | null;
    episodes?: SonarrEpisode[];
    qualityProfiles?: QualityProfile[];
    rootFolders?: RootFolder[];
    tags?: Tag[];
    animeData?: SeriesAniListResponse | null;
    tmdbData?: DiscoverTvFullDetail | null;
    credits?: SeriesCredits;
    seasonEpisodes?: Map<number, DiscoverSeasonDetailResponse>;
  } = {}) => {
    if (!Number.isFinite(seriesId)) return;
    setSeriesDetailSnapshot(seriesId, {
      series: next.series ?? series,
      episodes: next.episodes ?? episodes,
      qualityProfiles: next.qualityProfiles ?? qualityProfiles,
      rootFolders: next.rootFolders ?? rootFolders,
      tags: next.tags ?? tags,
      animeData: next.animeData ?? animeData,
      tmdbData: next.tmdbData ?? tmdbData,
      credits: next.credits ?? credits,
      seasonEpisodes: next.seasonEpisodes ?? seasonEpisodes,
    });
  }, [animeData, credits, episodes, qualityProfiles, rootFolders, seasonEpisodes, series, seriesId, tags, tmdbData]);

  const loadData = useCallback(async (hasCachedData: boolean) => {
    if (!Number.isFinite(seriesId)) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const activeSeriesId = seriesId;

    try {
      const [nextSeries, nextEpisodes, nextQualityProfiles, nextRootFolders, nextTags] = await Promise.all([
        fetch(`/api/sonarr/${seriesId}`).then((r) => r.ok ? r.json() : null),
        fetch(`/api/sonarr/${seriesId}/episodes`).then((r) => r.ok ? r.json() : []),
        fetch('/api/sonarr/qualityprofiles').then((r) => r.ok ? r.json() : []),
        fetch('/api/sonarr/rootfolders').then((r) => r.ok ? r.json() : []),
        fetch('/api/sonarr/tags').then((r) => r.ok ? r.json() : []),
      ]);

      if (activeSeriesId !== currentSeriesIdRef.current) return;

      const existingSnapshot = getSeriesDetailSnapshot(seriesId);
      setSeries(nextSeries);
      setEpisodes(nextEpisodes);
      setQualityProfiles(nextQualityProfiles);
      setRootFolders(nextRootFolders);
      setTags(nextTags);

      setSeriesDetailSnapshot(seriesId, {
        series: nextSeries,
        episodes: nextEpisodes,
        qualityProfiles: nextQualityProfiles,
        rootFolders: nextRootFolders,
        tags: nextTags,
        animeData: existingSnapshot?.animeData ?? null,
        tmdbData: existingSnapshot?.tmdbData ?? null,
        credits: existingSnapshot?.credits,
        seasonEpisodes: existingSnapshot?.seasonEpisodes,
      });
    } catch {
      if (activeSeriesId !== currentSeriesIdRef.current) return;

      if (!hasCachedData) {
        setSeries(null);
        setEpisodes([]);
        setQualityProfiles([]);
        setRootFolders([]);
        setTags([]);
      }
    } finally {
      if (activeSeriesId !== currentSeriesIdRef.current) return;

      setLoading(false);
      setRefreshing(false);
    }
  }, [seriesId]);

  useEffect(() => {
    const cached = Number.isFinite(seriesId) ? getSeriesDetailSnapshot(seriesId) : null;
    scrollReadyRef.current = false;
    hasRestoredScrollRef.current = false;

    if (cached) {
      setSeries(cached.series);
      setEpisodes(cached.episodes);
      setQualityProfiles(cached.qualityProfiles);
      setRootFolders(cached.rootFolders);
      setTags(cached.tags);
      setAnimeData(cached.animeData ?? null);
      setTmdbData(cached.tmdbData ?? null);
      setCredits(cached.credits ?? { cast: [], crew: [] });
      setSeasonEpisodes(cached.seasonEpisodes ?? new Map());
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    void loadData(Boolean(cached));
  }, [loadData, seriesId]);

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
    setExpandedSeasons(new Set());
    if (!getSeriesDetailSnapshot(seriesId)?.seasonEpisodes) {
      setSeasonEpisodes(new Map());
    }
  }, [seriesId]);

  // Anime with no AniList match (auto-unmatched or manually unmapped) fall back to
  // TMDB series-level enrichment like normal shows. Episode-level TMDB data stays
  // disabled for anime regardless — episode orders rarely line up with TMDB.
  const animeTmdbFallback = series?.seriesType === 'anime' && animeData !== null && animeData.details.length === 0;

  useEffect(() => {
    if (!Number.isFinite(seriesId) || !series?.id || (series.seriesType === 'anime' && !animeTmdbFallback)) {
      setCredits({ cast: [], crew: [] });
      return;
    }

    if (!getSeriesDetailSnapshot(seriesId)?.credits) {
      setCredits({ cast: [], crew: [] });
    }
    const controller = new AbortController();
    fetch(`/api/sonarr/${seriesId}/credits`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : { cast: [], crew: [] })
      .then((data: SeriesCredits) => {
        setCredits(data);
        const cached = getSeriesDetailSnapshot(seriesId);
        setSeriesDetailSnapshot(seriesId, {
          series: cached?.series ?? null,
          episodes: cached?.episodes ?? [],
          qualityProfiles: cached?.qualityProfiles ?? [],
          rootFolders: cached?.rootFolders ?? [],
          tags: cached?.tags ?? [],
          animeData: cached?.animeData ?? null,
          tmdbData: cached?.tmdbData ?? null,
          credits: data,
          seasonEpisodes: cached?.seasonEpisodes,
        });
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });

    return () => {
      controller.abort();
    };
  }, [animeTmdbFallback, series?.id, series?.seriesType, seriesId]);

  // Background-fetch TMDB enrichment data
  useEffect(() => {
    if (!series?.tmdbId || (series.seriesType === 'anime' && !animeTmdbFallback)) {
      setTmdbData(null);
      return;
    }
    const controller = new AbortController();
    if (!getSeriesDetailSnapshot(seriesId)?.tmdbData) {
      setTmdbData(null);
    }
    fetch(`/api/discover/tv/${series.tmdbId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DiscoverTvFullDetail | null) => {
        setTmdbData(data);
        const cached = getSeriesDetailSnapshot(seriesId);
        setSeriesDetailSnapshot(seriesId, {
          series: cached?.series ?? null,
          episodes: cached?.episodes ?? [],
          qualityProfiles: cached?.qualityProfiles ?? [],
          rootFolders: cached?.rootFolders ?? [],
          tags: cached?.tags ?? [],
          animeData: cached?.animeData ?? null,
          tmdbData: data,
          credits: cached?.credits,
          seasonEpisodes: cached?.seasonEpisodes,
        });
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTmdbData((prev) => prev ?? null);
      });
    return () => controller.abort();
  }, [animeTmdbFallback, series?.seriesType, series?.tmdbId, seriesId]);

  useEffect(() => {
    if (!series?.id || series.seriesType !== 'anime') {
      setAnimeData(null);
      setAnimeLoading(false);
      return;
    }

    const controller = new AbortController();
    const cached = getSeriesDetailSnapshot(seriesId);
    if (cached?.animeData) {
      setAnimeData(cached.animeData);
      setAnimeLoading(false);
    } else {
      setAnimeData(null);
      setAnimeLoading(true);
    }

    fetch(`/api/sonarr/${series.id}/anime`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || 'Failed to load AniList details');
        }
        return response.json();
      })
      .then((data: SeriesAniListResponse) => {
        if (!controller.signal.aborted) {
          setAnimeData(data);
          const current = getSeriesDetailSnapshot(seriesId);
          setSeriesDetailSnapshot(seriesId, {
            series: current?.series ?? null,
            episodes: current?.episodes ?? [],
            qualityProfiles: current?.qualityProfiles ?? [],
            rootFolders: current?.rootFolders ?? [],
            tags: current?.tags ?? [],
            animeData: data,
            tmdbData: current?.tmdbData ?? null,
            credits: current?.credits,
            seasonEpisodes: current?.seasonEpisodes,
          });
        }
      })
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        if (!controller.signal.aborted) {
          if (!cached?.animeData) setAnimeData(null);
          toast.error(error instanceof Error ? error.message : 'Failed to load AniList details');
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) {
          setAnimeLoading(false);
        }
      });

    return () => controller.abort();
  }, [series?.id, series?.seriesType, seriesId]);

  useEffect(() => {
    if (series?.seriesType !== 'anime' || !series?.id) return;

    let cancelled = false;

    const refreshAnimeData = async () => {
      try {
        const response = await fetch(`/api/sonarr/${series.id}/anime`);
        if (!response.ok) return;
        const data: SeriesAniListResponse = await response.json();
        if (!cancelled) {
          setAnimeData(data);
          const cached = getSeriesDetailSnapshot(seriesId);
          setSeriesDetailSnapshot(seriesId, {
            series: cached?.series ?? null,
            episodes: cached?.episodes ?? [],
            qualityProfiles: cached?.qualityProfiles ?? [],
            rootFolders: cached?.rootFolders ?? [],
            tags: cached?.tags ?? [],
            animeData: data,
            tmdbData: cached?.tmdbData ?? null,
            credits: cached?.credits,
            seasonEpisodes: cached?.seasonEpisodes,
          });
        }
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
  }, [series?.id, series?.seriesType, seriesId]);

  useEffect(() => {
    setAnimeNowMs(Date.now());

    const list = animeData?.details ?? [];
    const activeDetail = list[Math.min(activeAnimeTab, Math.max(0, list.length - 1))] ?? null;
    if (!activeDetail?.nextAiringEpisode) return;

    const tick = window.setInterval(() => {
      setAnimeNowMs(Date.now());
    }, 60_000);

    return () => {
      window.clearInterval(tick);
    };
  }, [animeData, activeAnimeTab]);

  function toggleSeasonExpand(seasonNumber: number) {
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) {
        next.delete(seasonNumber);
      } else {
        next.add(seasonNumber);
        if (!seasonEpisodes.has(seasonNumber) && series?.tmdbId) {
          const activeSeriesId = seriesId;
          fetch(`/api/discover/tv/${series.tmdbId}/season/${seasonNumber}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: DiscoverSeasonDetailResponse | null) => {
              if (data && activeSeriesId === currentSeriesIdRef.current) {
                const cached = getSeriesDetailSnapshot(activeSeriesId);
                const nextSeasonEpisodes = new Map(cached?.seasonEpisodes ?? seasonEpisodes).set(seasonNumber, data);
                setSeasonEpisodes(nextSeasonEpisodes);
                setSeriesDetailSnapshot(activeSeriesId, {
                  series: cached?.series ?? series,
                  episodes: cached?.episodes ?? episodes,
                  qualityProfiles: cached?.qualityProfiles ?? qualityProfiles,
                  rootFolders: cached?.rootFolders ?? rootFolders,
                  tags: cached?.tags ?? tags,
                  animeData: cached?.animeData ?? animeData,
                  tmdbData: cached?.tmdbData ?? tmdbData,
                  credits: cached?.credits ?? credits,
                  seasonEpisodes: nextSeasonEpisodes,
                });
              }
            })
            .catch(() => { });
        }
      }
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
    setAnimeData(next);
    setAnimeOverviewExpanded(false);
    setActiveAnimeTab(0);
    if (next.details.length > 0) {
      // A match now exists — drop the TMDB fallback data (state + snapshot).
      setTmdbData(null);
      setCredits({ cast: [], crew: [] });
      const cached = getSeriesDetailSnapshot(seriesId);
      setSeriesDetailSnapshot(seriesId, {
        series: cached?.series ?? series,
        episodes: cached?.episodes ?? episodes,
        qualityProfiles: cached?.qualityProfiles ?? qualityProfiles,
        rootFolders: cached?.rootFolders ?? rootFolders,
        tags: cached?.tags ?? tags,
        animeData: next,
        tmdbData: null,
        credits: { cast: [], crew: [] },
        seasonEpisodes: cached?.seasonEpisodes,
      });
    }
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
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeriesSearch', seriesId: series.id }),
      });
      toast.success('Series search started');
    } catch { toast.error('Search failed'); }
    finally { setActionLoading(''); }
  }

  async function handleToggleMonitored() {
    if (!series) return;
    setActionLoading('monitor');
    try {
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...series, monitored: !series.monitored }),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        setSeries(updated);
        persistSeriesSnapshot({ series: updated });
        for (const season of updated.seasons) {
          patchSeasonAcrossSnapshots(updated.id, season.seasonNumber, () => season);
        }
        invalidateListData('series');
        toast.success(updated.monitored ? 'Now monitored' : 'Unmonitored');
      }
    } catch { toast.error('Failed to update'); }
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
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        setSeries(updated);
        persistSeriesSnapshot({ series: updated });
        const updatedSeason = updated.seasons.find((s) => s.seasonNumber === seasonNumber);
        if (updatedSeason) {
          patchSeasonAcrossSnapshots(updated.id, seasonNumber, () => updatedSeason);
        }
        invalidateListData('series');
        toast.success(`Season ${seasonNumber} ${monitored ? 'monitored' : 'unmonitored'}`);
      }
    } catch { toast.error('Failed to update season'); }
  }

  async function handleApplyMonitor() {
    if (!series || !monitorOption) return;
    setActionLoading('applyMonitor');
    try {
      await fetch('/api/sonarr/command', {
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
      const updateRes = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(monitorUpdate),
      });
      if (updateRes.ok) {
        const updated: SonarrSeries = await updateRes.json();
        setSeries(updated);
        persistSeriesSnapshot({ series: updated });
        for (const season of updated.seasons) {
          patchSeasonAcrossSnapshots(updated.id, season.seasonNumber, () => season);
        }
        invalidateListData('series');
        toast.success(`Monitor set to: ${MONITOR_OPTIONS.find((o) => o.value === monitorOption)?.label}`);
        setShowMonitorEdit(false);
      } else {
        toast.error('Failed to update monitor');
      }
    } catch { toast.error('Failed to update monitor'); }
    finally { setActionLoading(''); }
  }

  async function handleRefresh() {
    if (!series) return;
    setActionLoading('refresh');
    try {
      const res = await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshSeries', seriesId: series.id }),
      });
      if (!res.ok) throw new Error('Refresh failed');
      const command = await res.json() as { id?: number };
      toast.success('Refresh started');
      const status = command.id ? await pollCommand('sonarr', command.id) : 'completed';
      invalidateListData('series');
      await loadData(true);
      if (status === 'completed') toast.success('Refresh complete');
      else if (status === 'timeout') toast.warning('Refresh still running');
      else toast.error('Refresh failed');
    } catch { toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleDelete() {
    if (!series) return;
    setDeleting(true);
    try {
      await fetch(`/api/sonarr/${series.id}?deleteFiles=true`, { method: 'DELETE' });
      invalidateListData('series');
      clearSeriesDetailSnapshot(series.id);
      toast.success('Series deleted');
      router.push('/series');
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  // Loading skeleton
  if (loading) {
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
  const animeDetails = animeData?.details ?? [];
  const activeAnimeIdx = animeDetails.length ? Math.min(activeAnimeTab, animeDetails.length - 1) : 0;
  const animeDetail = animeDetails[activeAnimeIdx] ?? null;
  const animeMapping = animeData?.mapping ?? null;
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
                {isAnimeSeries && (
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
                {externalUrls.SONARR && series.titleSlug && (
                  <DropdownMenuItem asChild>
                    <a href={`${externalUrls.SONARR}/series/${series.titleSlug}`} target="_blank" rel="noopener noreferrer">
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
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setShowAddWatchlist(true)}>
                  <Bookmark className="h-4 w-4" />
                  Add to Watchlist…
                </DropdownMenuItem>
                {canEditMonitoring && (
                  <DropdownMenuItem onClick={() => setShowMonitorEdit(true)}>
                    <Eye className="h-4 w-4" />
                    Monitor
                  </DropdownMenuItem>
                )}
                {canEditSeries && (
                  <DropdownMenuItem onClick={() => router.push(`/series/${id}/edit`)}>
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
        {isAnimeSeries && animeDetails.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pt-1 pb-3 -mx-2 px-2 md:mx-0 md:px-0 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {animeDetails.map((detail, index) => {
              const label = detail.seasonYear ? `${detail.title} · ${detail.seasonYear}` : detail.title;
              const active = index === activeAnimeIdx;
              return (
                <button
                  key={detail.id}
                  onClick={() => setActiveAnimeTab(index)}
                  className={`shrink-0 max-w-[180px] truncate rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    active
                      ? 'bg-[var(--hpr-amber)]/20 text-[var(--hpr-amber)]'
                      : 'bg-muted/30 text-muted-foreground active:bg-muted/50'
                  }`}
                >
                  {label}
                </button>
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
        ) : tmdbData?.backdropPath ? (
          <div className='-mx-2 md:-mx-6'>
            <div className="relative w-full h-[220px] overflow-hidden bg-muted/40 ">
              <Image
                src={toCachedImageSrc(tmdbData.backdropPath, 'tmdb') || tmdbData.backdropPath}
                alt=""
                fill
                sizes="100vw"
                className="object-cover"
                priority
                unoptimized
              />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
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

            {/* Trailer */}
            {!animeLoading && animeDetail && (
              <AnimeTrailerRail
                trailer={animeDetail.trailer}
                externalLinks={animeDetail.externalLinks}
                title={animeDetail.title}
              />
            )}

            {!animeLoading && !animeDetail && (
              <p className="text-xs text-muted-foreground">
                No AniList match found. Tap AniList in Information to remap manually.
              </p>
            )}
          </div>
        )}

        {/* Borderless metadata rows */}
        <div className="space-y-0">
          <div className="flex py-2 border-b border-border/30">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider w-20 shrink-0 pt-0.5">Status</span>
            <span className="text-sm capitalize">{series.status}</span>
          </div>
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
              const epData = seasonEpisodes.get(sn);

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
                    <Link href={`/series/${id}/season/${sn}`} className="flex-1 min-w-0 flex items-center gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{sn === 0 ? 'Specials' : `Season ${sn}`}</span>
                          <span className="text-sm text-muted-foreground">{fileCount}/{total}</span>
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
                  {isExpanded && (
                    <div className="pb-3 pl-2">
                      {epData ? (
                        epData.episodes.map((ep) => {
                          const sonarrEp = seasonEps.find((e) => e.episodeNumber === ep.episodeNumber);
                          const episodeHref = sonarrEp
                            ? `/series/${id}/season/${sn}/episode/${sonarrEp.id}`
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
                      ) : (
                        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
                          <Loader2 className="h-4 w-4 animate-spin" />
                          Loading episodes...
                        </div>
                      )}
                    </div>
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
            {isAnimeSeries && (
              <button
                onClick={() => setShowAniListRemap(true)}
                className="flex justify-between items-center w-full py-2.5 border-b border-border/30 -mx-2 px-2 rounded active:bg-muted/30"
              >
                <span className="text-sm text-muted-foreground">AniList</span>
                <span className="flex items-center gap-2 text-sm text-right">
                  {formatAniListMappingState(animeMapping?.state)}
                  {animeDetails.length > 1 ? ` · ${animeDetails.length} seasons` : ''}
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
                  viewAllHref={`/series/${seriesId}/credits?type=cast`}
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
                  viewAllHref={`/series/${seriesId}/credits?type=crew`}
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
                    className={`grouped-row w-full text-left active:bg-white/5 transition-colors ${monitorOption === option.value ? 'text-primary' : ''
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
      />
    </div>
  );
}
