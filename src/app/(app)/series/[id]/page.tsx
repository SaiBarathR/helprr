'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle,
  DrawerDescription, DrawerFooter, DrawerClose,
} from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { PageHeader } from '@/components/layout/page-header';
import { getImageUrl } from '@/components/media/media-card';
import { VirtualizedPersonRail } from '@/components/media/virtualized-person-rail';
import {
  Bookmark, MoreHorizontal, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Loader2, Tv, Heart, Eye, Star, ChevronDown, ChevronUp, ChevronRight,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, QualityProfile, RootFolder, Tag, DiscoverTvFullDetail, DiscoverSeasonDetailResponse } from '@/types';
import {
  getSeriesDetailSnapshot,
  patchSeasonAcrossSnapshots,
  setSeriesDetailSnapshot,
} from '@/lib/series-route-cache';
import { isProtectedApiImageSrc, toCachedImageSrc } from '@/lib/image';
import { useExternalUrls } from '@/lib/hooks/use-external-urls';
import { DiscoverVideoRail } from '@/components/discover/discover-video-rail';
import { DiscoverMediaRail } from '@/components/discover/discover-media-rail';
import { DiscoverWatchProvidersSection } from '@/components/discover/discover-watch-providers';

interface SeriesCredits {
  cast: { id: number; name: string; profilePath: string | null; character: string; episodeCount?: number }[];
  crew: { id: number; name: string; profilePath: string | null; job: string }[];
}

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const seriesId = Number(id);
  const currentSeriesIdRef = useRef(seriesId);
  currentSeriesIdRef.current = seriesId;
  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [showDelete, setShowDelete] = useState(false);
  const [showMonitorEdit, setShowMonitorEdit] = useState(false);
  const [monitorOption, setMonitorOption] = useState('');
  const [deleting, setDeleting] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const externalUrls = useExternalUrls();
  const [jellyfinLoading, setJellyfinLoading] = useState(false);
  const [credits, setCredits] = useState<SeriesCredits>({ cast: [], crew: [] });
  const [tmdbData, setTmdbData] = useState<DiscoverTvFullDetail | null>(null);
  const [expandedSeasons, setExpandedSeasons] = useState<Set<number>>(new Set());
  const [seasonEpisodes, setSeasonEpisodes] = useState<Map<number, DiscoverSeasonDetailResponse>>(new Map());

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
  const [qualityProfiles, setQualityProfiles] = useState<QualityProfile[]>([]);
  const [rootFolders, setRootFolders] = useState<RootFolder[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);

  const persistSeriesSnapshot = useCallback((next: {
    series?: SonarrSeries | null;
    episodes?: SonarrEpisode[];
    qualityProfiles?: QualityProfile[];
    rootFolders?: RootFolder[];
    tags?: Tag[];
  } = {}) => {
    if (!Number.isFinite(seriesId)) return;
    setSeriesDetailSnapshot(seriesId, {
      series: next.series ?? series,
      episodes: next.episodes ?? episodes,
      qualityProfiles: next.qualityProfiles ?? qualityProfiles,
      rootFolders: next.rootFolders ?? rootFolders,
      tags: next.tags ?? tags,
    });
  }, [episodes, qualityProfiles, rootFolders, series, seriesId, tags]);

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

    if (cached) {
      setSeries(cached.series);
      setEpisodes(cached.episodes);
      setQualityProfiles(cached.qualityProfiles);
      setRootFolders(cached.rootFolders);
      setTags(cached.tags);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    void loadData(Boolean(cached));

    if (!Number.isFinite(seriesId)) {
      setCredits({ cast: [], crew: [] });
      return;
    }

    // Background fetch for TMDB credits (non-blocking)
    setCredits({ cast: [], crew: [] });
    const controller = new AbortController();
    fetch(`/api/sonarr/${seriesId}/credits`, { signal: controller.signal })
      .then((r) => r.ok ? r.json() : { cast: [], crew: [] })
      .then((data: SeriesCredits) => setCredits(data))
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
      });

    return () => {
      controller.abort();
    };
  }, [loadData, seriesId]);

  // Background-fetch TMDB enrichment data
  useEffect(() => {
    if (!series?.tmdbId) {
      setTmdbData(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/discover/tv/${series.tmdbId}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DiscoverTvFullDetail | null) => setTmdbData(data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTmdbData(null);
      });
    return () => controller.abort();
  }, [series?.tmdbId]);

  function toggleSeasonExpand(seasonNumber: number) {
    setExpandedSeasons((prev) => {
      const next = new Set(prev);
      if (next.has(seasonNumber)) {
        next.delete(seasonNumber);
      } else {
        next.add(seasonNumber);
        if (!seasonEpisodes.has(seasonNumber) && series?.tmdbId) {
          fetch(`/api/discover/tv/${series.tmdbId}/season/${seasonNumber}`)
            .then((r) => (r.ok ? r.json() : null))
            .then((data: DiscoverSeasonDetailResponse | null) => {
              if (data) {
                setSeasonEpisodes((prev) => new Map(prev).set(seasonNumber, data));
              }
            })
            .catch(() => {});
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
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'RefreshSeries', seriesId: series.id }),
      });
      toast.success('Refresh started');
    } catch { toast.error('Refresh failed'); }
    finally { setActionLoading(''); }
  }

  async function handleDelete() {
    if (!series) return;
    setDeleting(true);
    try {
      await fetch(`/api/sonarr/${series.id}?deleteFiles=true`, { method: 'DELETE' });
      toast.success('Series deleted');
      router.push('/series');
    } catch { toast.error('Delete failed'); }
    finally { setDeleting(false); }
  }

  // Loading skeleton
  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <div className="flex gap-4 px-4">
          <Skeleton className="h-40 w-28 rounded-lg shrink-0" />
          <div className="flex-1 space-y-2 pt-2">
            <Skeleton className="h-5 w-20" />
            <Skeleton className="h-6 w-full" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
        <div className="space-y-2 px-4">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-3/4" />
        </div>
        <div className="space-y-1 px-4">
          {[1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </div>
    );
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

  return (
    <div className="flex flex-col min-h-0">
      {/* Page Header */}
      <PageHeader
        title={series.title}
        onBack={() => router.push('/series')}
        rightContent={
          <div className="flex items-center gap-0.5">
            {refreshing && !loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
            )}
            {/* Bookmark / Monitor toggle */}
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

            {/* 3-dot dropdown */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem onClick={handleRefresh} disabled={actionLoading === 'refresh'}>
                  <RefreshCw className="h-4 w-4" />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleSearchAll} disabled={actionLoading === 'search'}>
                  <Search className="h-4 w-4" />
                  Search Monitored
                </DropdownMenuItem>
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
                <DropdownMenuItem onClick={() => setShowMonitorEdit(true)}>
                  <Eye className="h-4 w-4" />
                  Monitor
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => router.push(`/series/${id}/edit`)}>
                  <Pencil className="h-4 w-4" />
                  Edit
                </DropdownMenuItem>
                <DropdownMenuItem variant="destructive" onClick={() => setShowDelete(true)}>
                  <Trash2 className="h-4 w-4" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      <div className="flex-1 overflow-y-auto">
        {/* Hero: Backdrop or flat poster layout */}
        {tmdbData?.backdropPath ? (
          <div>
            <div className="relative w-full aspect-[16/9] overflow-hidden">
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
            <div className="relative -mt-20 px-4 flex gap-4">
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
              <div className="flex-1 min-w-0 pt-6">
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
              <p className="px-4 mt-3 text-sm italic text-muted-foreground">&ldquo;{tmdbData.tagline}&rdquo;</p>
            )}
          </div>
        ) : (
          <div className="flex gap-4 px-4 pt-3 pb-4">
            <div className="w-28 shrink-0">
              {poster ? (
                <Image
                  src={poster}
                  alt={series.title}
                  width={112}
                  height={168}
                  className="w-full h-auto aspect-[2/3] object-cover rounded-lg"
                  unoptimized={isProtectedApiImageSrc(poster)}
                />
              ) : (
                <div className="w-full aspect-[2/3] rounded-lg bg-muted flex items-center justify-center">
                  <Tv className="h-10 w-10 text-muted-foreground" />
                </div>
              )}
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

        {/* Borderless metadata rows */}
        <div className="px-4 space-y-0">
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
          <div className="px-4 pt-4 pb-2">
            <p
              className={`text-sm text-muted-foreground leading-relaxed ${
                !overviewExpanded ? 'line-clamp-3' : ''
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
          <div className="px-4 pt-2">
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

        {/* Cast & Crew */}
        {credits.cast.length > 0 && (
          <div className="mt-4">
            <VirtualizedPersonRail
              title="Cast"
              titleClassName="text-lg font-bold px-4 mb-2"
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
              titleClassName="text-lg font-bold px-4 mb-2"
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

        {/* Seasons list */}
        <div className="mt-4 px-4">
          <h2 className="text-lg font-bold mb-2">Seasons</h2>
          <div>
            {seasonNumbers.map((sn) => {
              const seasonEps = episodes.filter((e) => e.seasonNumber === sn);
              const fileCount = seasonEps.filter((e) => e.hasFile).length;
              const total = seasonEps.length;
              const seasonData = series.seasons.find((s) => s.seasonNumber === sn);
              const isMonitored = seasonData?.monitored ?? true;
              const tmdbSeason = tmdbData?.seasons?.find((s) => s.seasonNumber === sn);
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
                    {/* Expand/collapse for TMDB episodes */}
                    {tmdbData && (
                      <button
                        onClick={() => toggleSeasonExpand(sn)}
                        className="min-w-[36px] min-h-[44px] flex items-center justify-center"
                      >
                        {isExpanded ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                      </button>
                    )}
                    {/* Monitor toggle */}
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
        <div className="mt-6 px-4 pb-8">
          <h2 className="text-lg font-bold mb-2">Information</h2>
          <div className="space-y-0">
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Quality Profile</span>
              <span className="text-sm">{qualityProfile?.name || 'Unknown'}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Series Type</span>
              <span className="text-sm capitalize">{series.seriesType}</span>
            </div>
            {seriesTags.length > 0 && (
              <div className="flex justify-between py-2.5 border-b border-border/30">
                <span className="text-sm text-muted-foreground">Tags</span>
                <span className="text-sm">{seriesTags.map((t) => t.label).join(', ')}</span>
              </div>
            )}
            {rootFolder && (
              <div className="flex justify-between py-2.5 border-b border-border/30">
                <span className="text-sm text-muted-foreground shrink-0">Root Folder</span>
                <span className="text-sm text-right truncate ml-4">{rootFolder.path}</span>
              </div>
            )}
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">New Seasons</span>
              <span className="text-sm">{series.monitored ? 'Monitored' : 'Not Monitored'}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Season Folders</span>
              <span className="text-sm">{series.seasonFolder ? 'Yes' : 'No'}</span>
            </div>
            <div className="flex justify-between py-2.5 border-b border-border/30">
              <span className="text-sm text-muted-foreground">Added</span>
              <span className="text-sm">
                {series.added ? format(new Date(series.added), 'MMM d, yyyy') : 'Unknown'}
              </span>
            </div>
          </div>
        </div>

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
              <div className="px-4">
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
              <div className="px-4">
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
      </div>

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
                    className={`grouped-row w-full text-left active:bg-white/5 transition-colors ${
                      monitorOption === option.value ? 'text-primary' : ''
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
    </div>
  );
}
