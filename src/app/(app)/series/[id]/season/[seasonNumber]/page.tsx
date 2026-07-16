'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose,
} from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import { ScheduledAlertDialog } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import {
  Bell, Bookmark, BookmarkCheck, MoreHorizontal, Search, RefreshCw, Trash2, Loader2, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, DiscoverSeasonDetailResponse } from '@/types';
import { toCachedImageSrc } from '@/lib/image';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { invalidateSeries } from '@/lib/query-invalidation';
import { arrMutationFetch, ensureArray, jsonFetcher } from '@/lib/query-fetch';
import { handleAuthError } from '@/lib/query-client';
import { patchEpisodesInCache, tvSeasonKey } from '@/lib/series-query-cache';
import { pollCommand } from '@/lib/arr-command';
import { useCan } from '@/components/permission-provider';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { useSeriesEpisodeWatch } from '@/components/jellyfin/use-series-episode-watch';
import { EpisodeWatchIndicator } from '@/components/jellyfin/watch-status-indicator';
import { episodeKey } from '@/types/watch-status';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}


export default function SeasonDetailPage() {
  const { id, seasonNumber: seasonNumberParam } = useParams();
  const router = useRouter();
  const seriesId = Number(id);
  const seasonNumber = Number(seasonNumberParam);
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();

  const [actionLoading, setActionLoading] = useState('');
  const [showDeleteDrawer, setShowDeleteDrawer] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);
  const [episodeInteractiveTarget, setEpisodeInteractiveTarget] = useState<{
    episodeId: number;
    title: string;
  } | null>(null);
  const [showScheduleAlert, setShowScheduleAlert] = useState(false);

  const canEditMonitoring = useCan('series.editMonitoring');
  const canDeleteSeries = useCan('series.delete');
  const canManageActivity = useCan('activity.manage');
  const canScheduleAlert = useCan('scheduledAlerts.edit');

  // Series + episodes share queryKeys.detail / .episodes with the series-detail
  // and episode pages, so a monitor change on any of them reflects here.
  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', seriesId, instance),
    queryFn: jsonFetcher<SonarrSeries | null>(`/api/sonarr/${seriesId}`, instance),
    enabled: Number.isFinite(seriesId) && Number.isFinite(seasonNumber),
  });
  const series = seriesQuery.data ?? null;
  const allEpisodesQuery = useQuery({
    queryKey: queryKeys.episodes(seriesId, instance),
    queryFn: jsonFetcher<SonarrEpisode[]>(`/api/sonarr/${seriesId}/episodes`, instance),
    enabled: Number.isFinite(seriesId) && Number.isFinite(seasonNumber),
    select: ensureArray,
  });
  const episodes = (allEpisodesQuery.data ?? [])
    .filter((e) => e.seasonNumber === seasonNumber)
    .sort((a, b) => a.episodeNumber - b.episodeNumber);
  const loading = seriesQuery.isLoading || allEpisodesQuery.isLoading;
  const refreshing = seriesQuery.isFetching || allEpisodesQuery.isFetching;

  // TMDB season data for episode images/ratings (skip for anime). Shares
  // tvSeasonKey with the series-detail expanded list + episode page.
  const tmdbSeasonQuery = useQuery({
    queryKey: tvSeasonKey(series?.tmdbId ?? 0, seasonNumber),
    queryFn: jsonFetcher<DiscoverSeasonDetailResponse>(`/api/discover/tv/${series?.tmdbId}/season/${seasonNumber}`),
    enabled: !!series?.tmdbId && series.seriesType !== 'anime',
    staleTime: 30 * 60_000,
  });
  const tmdbSeason = tmdbSeasonQuery.data ?? null;
  const { episodes: episodeWatch } = useSeriesEpisodeWatch({ tvdbId: series?.tvdbId, tmdbId: series?.tmdbId, imdbId: series?.imdbId });

  useEffect(() => {
    if (seriesQuery.isError || allEpisodesQuery.isError) toast.error('Failed to load season data');
  }, [seriesQuery.isError, allEpisodesQuery.isError]);

  const seasonData = series?.seasons.find((s) => s.seasonNumber === seasonNumber);
  const isSeasonMonitored = seasonData?.monitored ?? true;
  const totalSize = seasonData?.statistics?.sizeOnDisk || 0;

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
      await Promise.all([seriesQuery.refetch(), allEpisodesQuery.refetch()]);
      if (status === 'completed') toast.success('Refresh complete');
      else if (status === 'timeout') toast.warning('Refresh still running');
      else toast.error('Refresh failed');
    } catch (e) {
      handleAuthError(e);
      toast.error('Refresh failed');
    } finally {
      setActionLoading('');
    }
  }

  async function handleAutomaticSearch() {
    if (!series) return;
    setActionLoading('search');
    try {
      await arrMutationFetch(instance, '/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeasonSearch', seriesId: series.id, seasonNumber }),
      });
      toast.success(`Season ${seasonNumber} search started`);
    } catch (e) {
      handleAuthError(e);
      toast.error('Search failed');
    } finally {
      setActionLoading('');
    }
  }

  async function handleToggleSeasonMonitor() {
    if (!series) return;
    setActionLoading('monitor');
    try {
      const updatedSeries = {
        ...series,
        seasons: series.seasons.map((s) =>
          s.seasonNumber === seasonNumber ? { ...s, monitored: !isSeasonMonitored } : s
        ),
      };
      const res = await arrMutationFetch(instance, `/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        // Shared series key → reflects on the series-detail + episode views.
        queryClient.setQueryData(queryKeys.detail('sonarr', seriesId, instance), updated);
        toast.success(isSeasonMonitored ? 'Season unmonitored' : 'Season monitored');
      }
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to update season');
    } finally {
      setActionLoading('');
    }
  }

  async function handleToggleEpisodeMonitor(episodeId: number, monitored: boolean) {
    try {
      const res = await arrMutationFetch(instance, '/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [episodeId], monitored }),
      });
      if (res.ok) {
        patchEpisodesInCache(queryClient, seriesId, instance, [
          { episodeId, updater: (episode) => ({ ...episode, monitored }) },
        ]);
      }
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to update');
    }
  }

  async function handleDeleteSeason() {
    if (!series) return;
    setDeleting(true);
    try {
      // Unmonitor all episodes in this season
      const episodeIds = episodes.map((e) => e.id);
      if (episodeIds.length > 0) {
        const unmonitorEpisodesRes = await arrMutationFetch(instance, '/api/sonarr/episode/monitor', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeIds, monitored: false }),
        });
        if (!unmonitorEpisodesRes.ok) {
          toast.error('Failed to unmonitor season');
          return;
        }
      }
      // Unmonitor the season
      const updatedSeries = {
        ...series,
        seasons: series.seasons.map((s) =>
          s.seasonNumber === seasonNumber ? { ...s, monitored: false } : s
        ),
      };
      const updateSeasonRes = await arrMutationFetch(instance, `/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      patchEpisodesInCache(
        queryClient,
        seriesId,
        instance,
        episodes.map((episode) => ({
          episodeId: episode.id,
          updater: (existing) => ({ ...existing, monitored: false }),
        })),
      );
      if (updateSeasonRes.ok) {
        const updated: SonarrSeries = await updateSeasonRes.json();
        queryClient.setQueryData(queryKeys.detail('sonarr', seriesId, instance), updated);
      } else {
        // PUT failed — still reflect the season's optimistic unmonitor locally.
        queryClient.setQueryData<SonarrSeries | null>(
          queryKeys.detail('sonarr', seriesId, instance),
          (prev) =>
            prev
              ? {
                  ...prev,
                  seasons: prev.seasons.map((s) =>
                    s.seasonNumber === seasonNumber ? { ...s, monitored: false } : s,
                  ),
                }
              : prev,
        );
      }
      toast.success('Season unmonitored');
      setShowDeleteDrawer(false);
      router.back();
    } catch (e) {
      handleAuthError(e);
      toast.error('Failed to unmonitor season');
    } finally {
      setDeleting(false);
    }
  }

  if (loading && !series) {
    return <><PageHeader title="Season" /><PageSpinner /></>;
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const seasonTitle = seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;
  const fileCount = episodes.filter((e) => e.hasFile).length;
  const seasonContextGroups: ContextActionGroup[] = [
    {
      id: 'activity',
      actions: [
        ...(canEditMonitoring ? [{ id: 'monitor', label: isSeasonMonitored ? 'Unmonitor season' : 'Monitor season', icon: <Bookmark className="h-4 w-4" />, onSelect: () => { void handleToggleSeasonMonitor(); }, disabled: actionLoading === 'monitor' }] : []),
        ...(canManageActivity ? [
          { id: 'refresh', label: 'Refresh', icon: <RefreshCw className="h-4 w-4" />, onSelect: () => { void handleRefresh(); }, disabled: !!actionLoading },
          { id: 'search', label: 'Automatic Search', icon: <Search className="h-4 w-4" />, onSelect: () => { void handleAutomaticSearch(); }, disabled: !!actionLoading },
          { id: 'interactive', label: 'Interactive Search', icon: <Search className="h-4 w-4" />, onSelect: () => setInteractiveSearch(true) },
        ] : []),
      ],
    },
    {
      id: 'manage',
      actions: [
        ...(canScheduleAlert ? [{ id: 'schedule', label: 'Schedule alert…', icon: <Bell className="h-4 w-4" />, onSelect: () => setShowScheduleAlert(true) }] : []),
        ...(canDeleteSeries ? [{ id: 'unmonitor', label: 'Unmonitor Season…', icon: <Trash2 className="h-4 w-4" />, onSelect: () => setShowDeleteDrawer(true), destructive: true }] : []),
      ],
    },
  ];

  return (
    <div className="space-y-4 animate-content-in">
      <PageHeader
        subtitle={<Link href={`/series/${seriesId}${instance ? `?instance=${instance}` : ''}`} className="hover:underline">{series.title}</Link>}
        title={seasonTitle}
        onBack={() => router.push(`/series/${seriesId}${instance ? `?instance=${instance}` : ''}`)}
        rightContent={
          <div className="flex items-center gap-1">
            {refreshing && !loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
            )}
            {/* Monitor toggle */}
            {canEditMonitoring && (
              <button
                onClick={handleToggleSeasonMonitor}
                disabled={actionLoading === 'monitor'}
                className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
              >
                {actionLoading === 'monitor' ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
                ) : isSeasonMonitored ? (
                  <BookmarkCheck className="h-5 w-5" />
                ) : (
                  <Bookmark className="h-5 w-5" />
                )}
              </button>
            )}

            {/* 3-dot menu */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary">
                  <MoreHorizontal className="h-5 w-5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={handleRefresh} disabled={!!actionLoading}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Refresh
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleAutomaticSearch} disabled={!!actionLoading}>
                  <Search className="mr-2 h-4 w-4" />
                  Automatic Search
                </DropdownMenuItem>
                {canScheduleAlert && (
                  <DropdownMenuItem onClick={() => setShowScheduleAlert(true)}>
                    <Bell className="mr-2 h-4 w-4" />
                    Schedule alert…
                  </DropdownMenuItem>
                )}
                {canDeleteSeries && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDrawer(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Unmonitor Season
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Metadata line */}
      <QuickContextMenu label={`${seasonTitle} actions`} groups={seasonContextGroups}>
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <span>{series.year}</span>
        <span className="text-muted-foreground/40">|</span>
        {series.runtime > 0 && (
          <>
            <span>{series.runtime} min</span>
            <span className="text-muted-foreground/40">|</span>
          </>
        )}
        <span>{formatBytes(totalSize)}</span>
        <span className="text-muted-foreground/40">|</span>
        <span>{fileCount}/{episodes.length} episodes</span>
      </div>
      </QuickContextMenu>

      {/* Pill buttons — searching/grabbing is an activity.manage action */}
      {canManageActivity && (
        <div className="flex gap-2">
          <Button
            variant="secondary"
            className="rounded-full flex-1"
            onClick={handleAutomaticSearch}
            disabled={!!actionLoading}
          >
            {actionLoading === 'search' ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Automatic
          </Button>
          <Button
            variant="secondary"
            className="rounded-full flex-1"
            onClick={() => setInteractiveSearch(true)}
          >
            <Search className="mr-2 h-4 w-4" />
            Interactive
          </Button>
        </div>
      )}

      {/* Episode list */}
      <div className="space-y-0.5">
        {episodes.map((ep) => {
          const isFinale = ep.episodeNumber === episodes.length && episodes.length > 1;
          const isPremiere = ep.episodeNumber === 1;
          const tmdbEp = tmdbSeason?.episodes.find((e) => e.episodeNumber === ep.episodeNumber);

          const episodeHref = `/series/${id}/season/${seasonNumber}/episode/${ep.id}${instance ? `?instance=${instance}` : ''}`;
          const episodeActions = [
            { id: 'open', label: 'Open episode', href: episodeHref },
            ...(canEditMonitoring ? [{ id: 'monitor', label: ep.monitored ? 'Unmonitor episode' : 'Monitor episode', icon: <Bookmark className="h-4 w-4" />, onSelect: () => { void handleToggleEpisodeMonitor(ep.id, !ep.monitored); } }] : []),
            ...(canManageActivity ? [{
              id: 'interactive',
              label: 'Interactive search…',
              icon: <Search className="h-4 w-4" />,
              onSelect: () => {
                setEpisodeInteractiveTarget({
                  episodeId: ep.id,
                  title: ep.title || `Episode ${ep.episodeNumber}`,
                });
              },
            }] : []),
          ];

          return (
            <QuickContextMenu key={ep.id} label={`${ep.title || `Episode ${ep.episodeNumber}`} actions`} actions={episodeActions}>
            <Link
              href={episodeHref}
              className="flex gap-3 px-4 py-3 active:bg-muted/50 transition-colors"
            >
              {/* Episode still image or number fallback (skip for anime) */}
              {series?.seriesType !== 'anime' && (
                tmdbEp?.stillPath ? (
                  <div className="relative w-[100px] h-[56px] rounded-lg overflow-hidden shrink-0 bg-muted">
                    <Image
                      src={toCachedImageSrc(tmdbEp.stillPath, 'tmdb') || tmdbEp.stillPath}
                      alt=""
                      fill
                      sizes="100px"
                      className="object-cover"
                      unoptimized
                    />
                  </div>
                ) : (
                  <div className="w-[100px] h-[56px] rounded-lg bg-muted flex items-center justify-center shrink-0">
                    <span className="text-lg font-bold text-muted-foreground">{ep.episodeNumber}</span>
                  </div>
                )
              )}

              {/* Episode info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">
                    {ep.episodeNumber || 'TBA'}
                  </span>
                  <span className="text-sm font-medium">
                    {ep.title || 'TBA'}
                  </span>
                  {isPremiere && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Premiere
                    </Badge>
                  )}
                  {isFinale && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Finale
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
                  {ep.hasFile ? (
                    <Badge
                      variant="default"
                      className="text-[10px] bg-green-600 hover:bg-green-600"
                    >
                      DOWNLOADED
                    </Badge>
                  ) : ep.monitored ? (
                    <Badge variant="destructive" className="text-[10px]">
                      MISSING
                    </Badge>
                  ) : null}
                  <EpisodeWatchIndicator status={episodeWatch[episodeKey(seasonNumber, ep.episodeNumber)]} />
                  {(ep.airDateUtc || ep.airDate) && (
                    <span className="text-xs text-muted-foreground">
                      {ep.airDateUtc
                        ? format(new Date(ep.airDateUtc), "MMM d, yyyy 'at' h:mm a")
                        : format(new Date(ep.airDate), 'MMM d, yyyy')}
                    </span>
                  )}
                  {tmdbEp && tmdbEp.runtime && (
                    <span className="text-xs text-muted-foreground">{tmdbEp.runtime}m</span>
                  )}
                  {tmdbEp && tmdbEp.voteAverage > 0 && (
                    <span className="inline-flex items-center gap-0.5 text-xs text-muted-foreground">
                      <Star className="h-2.5 w-2.5 fill-yellow-400 text-yellow-400" />
                      {tmdbEp.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
                {tmdbEp?.overview && (
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1">{tmdbEp.overview}</p>
                )}
              </div>

              {/* Monitor bookmark */}
              {canEditMonitoring && (
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleToggleEpisodeMonitor(ep.id, !ep.monitored);
                  }}
                  className="min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0 self-center"
                >
                  {ep.monitored ? (
                    <BookmarkCheck className="h-4 w-4 text-primary" />
                  ) : (
                    <Bookmark className="h-4 w-4 text-muted-foreground" />
                  )}
                </button>
              )}
            </Link>
            </QuickContextMenu>
          );
        })}

        {episodes.length === 0 && (
          <div className="text-center py-12 text-muted-foreground text-sm">
            No episodes found for this season
          </div>
        )}
      </div>

      {/* Interactive Search Dialog */}
      <InteractiveSearchDialog
        open={interactiveSearch}
        onOpenChange={setInteractiveSearch}
        title={`${series.title} - ${seasonTitle}`}
        service="sonarr"
        searchParams={{ seriesId: series.id, seasonNumber, ...(instance ? { instanceId: instance } : {}) }}
        showSeasonPackFilter
      />

      <InteractiveSearchDialog
        open={episodeInteractiveTarget !== null}
        onOpenChange={(open) => { if (!open) setEpisodeInteractiveTarget(null); }}
        title={episodeInteractiveTarget ? `${series.title} - ${seasonTitle} - ${episodeInteractiveTarget.title}` : ''}
        service="sonarr"
        searchParams={{
          episodeId: episodeInteractiveTarget?.episodeId ?? 0,
          ...(instance ? { instanceId: instance } : {}),
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
            subtitle: seasonTitle,
            posterUrl:
              series.images?.find((i) => i.coverType === 'poster')?.remoteUrl ??
              series.images?.find((i) => i.coverType === 'poster')?.url ??
              null,
            overview: series.overview ?? null,
            instanceId: instance ?? null,
            href: `/series/${series.id}/season/${seasonNumber}${instance ? `?instance=${instance}` : ''}`,
            releaseDate: episodes[0]?.airDateUtc ?? null,
            seasonNumber,
          }}
        />
      )}

      {/* Delete/Unmonitor Confirmation Drawer */}
      <Drawer open={showDeleteDrawer} onOpenChange={setShowDeleteDrawer}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Unmonitor {seasonTitle}?</DrawerTitle>
            <DrawerDescription>
              This will unmonitor all episodes in {seasonTitle} of {series.title}.
              Episode files will not be deleted.
            </DrawerDescription>
          </DrawerHeader>
          <div className="p-4 flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteSeason}
              disabled={deleting}
              className="w-full"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Unmonitor Season
            </Button>
            <DrawerClose asChild>
              <Button variant="ghost" className="w-full">
                Cancel
              </Button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
