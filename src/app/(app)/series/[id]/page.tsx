'use client';

import { useRouteViewState } from '@/lib/hooks/use-route-view-state';

import { useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import Link from '@/components/ui/app-link';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ErrorState } from '@/components/ui/error-state';
import { PageHeader } from '@/components/layout/page-header';
import { AniListRemapDrawer } from '@/components/anime/anilist-remap-drawer';
import { getImageUrl } from '@/components/media/media-card';
import {
  Bookmark, RefreshCw, Search, ExternalLink,
  Pencil, Trash2, Tv, Eye, FileEdit, Sparkles, TriangleAlert, FileStack,
} from 'lucide-react';
import type { SonarrSeries, SonarrEpisode, DiscoverTvFullDetail } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ensureArray, jsonFetcher, nullOn404 } from '@/lib/query-fetch';
import { useQualityProfiles, useRootFolders, useTags } from '@/lib/hooks/use-reference-data';
import { useExternalUrls, useExternalUrlResolver } from '@/lib/hooks/use-external-urls';
import { RenamePreviewDialog } from '@/components/media/rename-preview-dialog';
import { formatBytes } from '@/lib/format';
import { AnilistStatusPanel } from '@/components/anime/anilist-status-panel';
import { WatchlistAddDialog } from '@/components/watchlist/watchlist-add-dialog';
import { ScheduledAlertDialog } from '@/components/scheduled-alerts/scheduled-alert-dialog';
import { AnimeTrailerRail } from '@/components/anime/anime-trailer-rail';
import { MediaDownloadProgress } from '@/components/media/media-download-progress';
import { useCan, useMe } from '@/components/permission-provider';
import {
  hasWatchLookupIdentity,
  useWatchLookup,
  useWatchStatus,
} from '@/components/jellyfin/watch-status-provider';
import { buildMarkWatchedContextAction } from '@/lib/mark-watched-context-action';
import { arrEditHref, arrManageHref } from '@/lib/arr-edit-href';
import { useSeriesEpisodeWatch } from '@/components/jellyfin/use-series-episode-watch';
import { PlayInHelprrButton } from '@/components/jellyfin/play-in-helprr-button';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';
import { useSeriesAnime } from './_components/use-series-anime';
import { useSeriesActions } from './_components/use-series-actions';
import { buildSeasonDetailRows, buildSeriesInfoRows, formatNextAiring, seriesStatusBadge } from './_components/series-info';
import { SeriesHeaderActions } from './_components/series-header-actions';
import { SeriesHero } from './_components/series-hero';
import { SeriesSeasons } from './_components/series-seasons';
import { SeriesInformation } from './_components/series-information';
import { SeriesAnimeSections } from './_components/series-anime-sections';
import { SeriesTmdbSections, type SeriesCredits } from './_components/series-tmdb-sections';
import { SeriesDeleteDrawer, SeriesMonitorDrawer } from './_components/series-drawers';
import type { SeriesCaps, SeriesDialog } from './_components/types';

export default function SeriesDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const seriesId = Number(id);
  const instance = useSearchParams().get('instance') ?? undefined;
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Series + episodes: TanStack's gcTime gives instant back-nav paint without a
  // bespoke snapshot, and these are shared keys (queryKeys.detail / .episodes) so
  // a monitor change on the season or episode view reflects here and vice-versa.
  const seriesQuery = useQuery({
    queryKey: queryKeys.detail('sonarr', seriesId, instance),
    // 404 → null (not an error) so "not found" renders, matching movies/music;
    // every other failure stays an error so it can't masquerade as missing.
    queryFn: (ctx): Promise<SonarrSeries | null> =>
      nullOn404(jsonFetcher<SonarrSeries>(`/api/sonarr/${seriesId}`, instance)(ctx)),
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
  const [showRenamePreview, setShowRenamePreview] = useState(false);
  const [overviewExpanded, setOverviewExpanded] = useState(false);
  const externalUrls = useExternalUrls();
  const sonarrExternalUrl = useExternalUrlResolver()('SONARR', instance);
  const [showAddWatchlist, setShowAddWatchlist] = useState(false);
  const [showScheduleAlert, setShowScheduleAlert] = useState(false);
  const [expandedSeasons, setExpandedSeasons] = useRouteViewState<Set<number>>('expandedSeasons', new Set());

  const canManageActivity = useCan('activity.manage');
  const canEditMonitoring = useCan('series.editMonitoring');
  const canEditTags = useCan('series.editTags');
  const canChangePath = useCan('series.changePath');
  const canAddSeries = useCan('series.add');
  const canDeleteSeries = useCan('series.delete');
  const canManageFiles = useCan('series.manageFiles');
  const canScheduleAlert = useCan('scheduledAlerts.edit');
  const canViewAnime = useCan('anime.view');
  const canEditSeries = canEditMonitoring || canEditTags || canChangePath;
  // AniList mapping mutations are admin-only server-side — hide their triggers
  // from members so they don't open a drawer whose saves would 403.
  const isAdmin = useMe()?.role === 'admin';
  const caps: SeriesCaps = { canManageActivity, canEditMonitoring, canEditSeries, canManageFiles, canDeleteSeries, canScheduleAlert, isAdmin };

  // Reference data — shared (and deduped) with the list / edit / add pages.
  const { data: qualityProfiles = [] } = useQualityProfiles('sonarr', instance);
  // The rootfolders route 403s without add/changePath, so skip the fetch (and
  // the Root Folder info row) for plain viewers instead of erroring.
  const { data: rootFolders = [] } = useRootFolders('sonarr', instance, canAddSeries || canChangePath);
  const { data: tags = [] } = useTags('sonarr', instance);

  const anime = useSeriesAnime({ series, seriesId, instance });
  const { animeData, animeLoading, animeEntries, animeDetail } = anime;

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
  const seriesWatchQuery = {
    kind: 'series' as const,
    tvdbId: series?.tvdbId,
    tmdbId: series?.tmdbId,
    imdbId: series?.imdbId,
  };
  const lookupWatch = useWatchLookup(hasWatchLookupIdentity(seriesWatchQuery));
  const { setWatched, canWrite: canSetWatched, isWriting: isWritingWatched } = useWatchStatus();
  const seriesWatch = lookupWatch(seriesWatchQuery);
  const watchedContextAction = series
    ? buildMarkWatchedContextAction({
        status: seriesWatch,
        canWrite: canSetWatched,
        isWriting: isWritingWatched,
        setWatched,
      })
    : null;
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

  const actions = useSeriesActions({
    series,
    seriesId,
    instance,
    jellyfinUrl: externalUrls.JELLYFIN,
    refetch: () => Promise.all([seriesQuery.refetch(), episodesQuery.refetch()]),
    onDeleted: () => router.push('/series'),
  });

  const open = (dialog: SeriesDialog) => {
    if (dialog === 'remap') anime.setShowAniListRemap(true);
    else if (dialog === 'watchlist') setShowAddWatchlist(true);
    else if (dialog === 'scheduleAlert') setShowScheduleAlert(true);
    else if (dialog === 'renamePreview') setShowRenamePreview(true);
    else if (dialog === 'delete') setShowDelete(true);
    else actions.setShowMonitorEdit(true);
  };

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

  // Loading skeleton
  if (loading && !series) {
    return <><PageHeader title="Series" /><PageSpinner /></>;
  }

  // Fetch failure is not "not found": only a confirmed 404 resolves to null.
  if (seriesQuery.isError && !series) {
    return (
      <>
        <PageHeader title="Series" />
        <ErrorState
          message="Couldn't load this series. Sonarr may be unreachable."
          onRetry={() => seriesQuery.refetch()}
          retrying={seriesQuery.isFetching}
        />
      </>
    );
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const poster = getImageUrl(series.images, 'poster', 'sonarr');
  const { label: statusLabel, className: statusColor } = seriesStatusBadge(series);
  const nextAiring = formatNextAiring(series);
  const isAnimeSeries = series.seriesType === 'anime';
  // Anime search (explore) needs anime.view; the detail page is also open to
  // series.view, so the mapped link always shows.
  const openInAnimeHref = animeDetail?.id
    ? `/anime/${animeDetail.id}`
    : canViewAnime ? `/anime/explore?search=${encodeURIComponent(series.title)}` : null;
  const alertReleaseDate =
    tmdbData?.releaseDate ?? series.releaseDate ?? series.firstAired ?? null;
  const infoRows = buildSeriesInfoRows({
    series,
    tmdbData,
    animeDetail,
    qualityProfileName: qualityProfiles.find((qp) => qp.id === series.qualityProfileId)?.name,
    tagLabels: tags.filter((t) => series.tags.includes(t.id)).map((t) => t.label),
    rootFolderPath: rootFolders.find((rf) => series.path?.startsWith(rf.path))?.path,
  });
  const seasonDetailRows = buildSeasonDetailRows(series);
  const jellyfinLinkable = Boolean(externalUrls.JELLYFIN && (series.imdbId || series.tvdbId));
  const posterUrl =
    series.images?.find((i) => i.coverType === 'poster')?.remoteUrl ??
    series.images?.find((i) => i.coverType === 'poster')?.url ??
    null;

  const seriesContextGroups: ContextActionGroup[] = [
    {
      id: 'activity',
      actions: [
        ...(watchedContextAction ? [watchedContextAction] : []),
        ...(canEditMonitoring ? [{ id: 'monitor-toggle', label: series.monitored ? 'Unmonitor' : 'Monitor', icon: <Bookmark className="h-4 w-4" />, onSelect: () => { void actions.toggleMonitored(); }, disabled: actions.actionLoading === 'monitor' }, { id: 'monitor-options', label: 'Monitoring options…', icon: <Eye className="h-4 w-4" />, onSelect: () => actions.setShowMonitorEdit(true) }] : []),
        ...(canManageActivity ? [
          { id: 'refresh', label: 'Refresh', icon: <RefreshCw className="h-4 w-4" />, onSelect: () => { void actions.refresh(); }, disabled: actions.actionLoading === 'refresh' },
          { id: 'search', label: 'Search Monitored', icon: <Search className="h-4 w-4" />, onSelect: () => { void actions.searchAll(); }, disabled: actions.actionLoading === 'search' },
        ] : []),
      ],
    },
    {
      id: 'manage',
      actions: [
        ...(canEditSeries ? [{ id: 'edit', label: 'Edit', icon: <Pencil className="h-4 w-4" />, href: arrEditHref('series', seriesId, instance) }] : []),
        ...(canManageActivity ? [{ id: 'rename', label: 'Preview Rename', icon: <FileEdit className="h-4 w-4" />, onSelect: () => setShowRenamePreview(true) }] : []),
        ...(canManageFiles ? [{ id: 'files', label: 'Manage Episodes', icon: <FileStack className="h-4 w-4" />, href: arrManageHref('series', seriesId, series.title, instance) }] : []),
      ],
    },
    {
      id: 'links',
      actions: [
        ...(isAnimeSeries && openInAnimeHref ? [{ id: 'anime', label: 'Open in Anime', icon: <Sparkles className="h-4 w-4" />, href: openInAnimeHref }] : []),
        ...(series.imdbId ? [{ id: 'imdb', label: 'Open in IMDb', icon: <ExternalLink className="h-4 w-4" />, href: `https://www.imdb.com/title/${series.imdbId}`, external: true }] : []),
        ...(series.tvdbId > 0 ? [{ id: 'tvdb', label: 'Open in TVDB', icon: <ExternalLink className="h-4 w-4" />, href: `https://www.thetvdb.com/?id=${series.tvdbId}&tab=series`, external: true }] : []),
        ...(sonarrExternalUrl && series.titleSlug ? [{ id: 'sonarr', label: 'Open in Sonarr', icon: <Tv className="h-4 w-4" />, href: `${sonarrExternalUrl}/series/${series.titleSlug}`, external: true }] : []),
        ...(externalUrls.JELLYFIN && (series.imdbId || series.tvdbId) ? [{ id: 'jellyfin', label: 'Open in Jellyfin', icon: <ExternalLink className="h-4 w-4" />, onSelect: () => { void actions.openInJellyfin(); }, disabled: actions.jellyfinLoading }] : []),
      ],
    },
    ...(canDeleteSeries ? [{ id: 'danger', actions: [{ id: 'delete', label: 'Delete', icon: <Trash2 className="h-4 w-4" />, onSelect: () => setShowDelete(true), destructive: true }] }] : []),
  ];

  return (
    <div
      className="flex flex-col min-h-0 animate-content-in -mx-2 md:-mx-6"
    >
      {/* Page Header */}
      <PageHeader
        title={series.title}
        backHref="/series"
        rightContent={
          <SeriesHeaderActions
            series={series}
            refreshing={refreshing && !loading}
            caps={caps}
            actions={actions}
            isAnimeSeries={isAnimeSeries}
            openInAnimeHref={openInAnimeHref}
            sonarrExternalUrl={sonarrExternalUrl}
            jellyfinUrl={externalUrls.JELLYFIN}
            seriesWatch={seriesWatch}
            open={open}
            onEdit={() => router.push(`/series/${id}/edit${instance ? `?instance=${instance}` : ''}`)}
            onManageEpisodes={() =>
              router.push(
                `/series/${id}/manage?title=${encodeURIComponent(series.title)}${instance ? `&instance=${instance}` : ''}`
              )
            }
          />
        }
      />

      <div ref={contentScrollRef} data-scroll-restoration-key="series-detail" className="flex-1 overflow-y-auto px-2 md:p-6">
        {/* Hero: Backdrop or flat poster layout */}
        <SeriesHero
          series={series}
          isAnimeSeries={isAnimeSeries}
          anime={anime}
          tmdbData={tmdbData}
          poster={poster}
          statusLabel={statusLabel}
          statusColor={statusColor}
          canScheduleAlert={canScheduleAlert}
          contextGroups={seriesContextGroups}
          open={open}
        />

        {/* Phones stack these in DOM order. On wide content areas .detail-grid
            (globals.css) puts the facts beside the overview, Play and AniList
            card and runs everything else full width. Sections keep their own
            spacing. */}
        <div className="@container">
          <div className="detail-grid detail-grid-series flex flex-col">
            {/* This page stacks sections without a space-y wrapper, so the card spaces itself
                (and adds nothing when there is no download). */}
            <MediaDownloadProgress source="sonarr" mediaId={series.id} instanceId={instance} className="my-4 [grid-area:progress]" />

            {isAnimeSeries && (
              <div className="pt-3 space-y-3 [grid-area:anilist]">
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
                      onClick={() => anime.setShowAniListRemap(true)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-muted/30 px-3 py-1.5 text-xs font-medium text-muted-foreground transition-colors active:bg-muted/50"
                    >
                      <Pencil className="h-3 w-3" />
                      AniList mapping{animeEntries.length > 1 ? ` · ${animeEntries.length} seasons` : ''}
                    </button>
                  ) : (
                    <button
                      onClick={() => anime.setShowAniListRemap(true)}
                      className="inline-flex items-center gap-1.5 rounded-full bg-[var(--hpr-amber)]/20 px-3 py-1.5 text-xs font-medium text-[var(--hpr-amber)] transition-colors active:bg-[var(--hpr-amber)]/30"
                    >
                      <TriangleAlert className="h-3.5 w-3.5" />
                      Map to AniList
                    </button>
                  )
                )}
              </div>
            )}

            {/* Trailer: its own row on desktop, so it sits with the media below. */}
            {isAnimeSeries && !animeLoading && animeDetail && (
              <div className="mt-3 empty:hidden [grid-area:trailer]">
                <AnimeTrailerRail
                  trailer={animeDetail.trailer}
                  externalLinks={animeDetail.externalLinks}
                  title={animeDetail.title}
                />
              </div>
            )}

            {/* Borderless metadata rows */}
            <div className="space-y-0 [grid-area:facts]">
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

            <div className="min-w-0 [grid-area:main]">
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
                      {overviewExpanded ? 'Show less' : 'Read more'}
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

              {/* Straight into Helprr's own player when the show is in Jellyfin. */}
              <PlayInHelprrButton
                imdbId={series.imdbId}
                tvdbId={series.tvdbId}
                tmdbId={series.tmdbId}
                autoPlay={false}
                className="mt-4 h-10 w-full rounded-full"
              />
            </div>

            {/* Seasons list */}
            <SeriesSeasons
              series={series}
              routeId={String(id)}
              instance={instance}
              episodes={episodes}
              episodesError={episodesQuery.isError}
              episodesFetching={episodesQuery.isFetching}
              onRetryEpisodes={() => episodesQuery.refetch()}
              tmdbData={tmdbData}
              expandedSeasons={expandedSeasons}
              onToggleExpand={toggleSeasonExpand}
              watchedBySeason={watchedBySeason}
              episodeWatch={episodeWatch}
              canEditMonitoring={canEditMonitoring}
              canManageActivity={canManageActivity}
              onToggleSeasonMonitor={actions.toggleSeasonMonitor}
            />

            {/* Information section */}
            <SeriesInformation
              infoRows={infoRows}
              seasonDetailRows={seasonDetailRows}
              showAniListMapping={isAnimeSeries && isAdmin}
              animeMapping={anime.animeMapping}
              linkedSeasons={animeEntries.length}
              onEditMapping={() => anime.setShowAniListRemap(true)}
            />

            <div className="min-w-0 [grid-area:rails]">
              {/* AniList sections when matched; unmatched anime fall through to the
                  TMDB enrichment branch (series-level only — episode list stays Sonarr-only) */}
              {isAnimeSeries && animeDetail ? (
                <SeriesAnimeSections
                  animeDetail={animeDetail}
                  overviewExpanded={anime.animeOverviewExpanded}
                  onToggleOverview={() => anime.setAnimeOverviewExpanded(!anime.animeOverviewExpanded)}
                  jellyfinLink={jellyfinLinkable ? { loading: actions.jellyfinLoading, onOpen: actions.openInJellyfin } : null}
                />
              ) : (
                <SeriesTmdbSections credits={credits} tmdbData={tmdbData} seriesId={seriesId} instance={instance} />
              )}
            </div>
          </div>
        </div>
      </div>

      <AniListRemapDrawer
        open={anime.showAniListRemap}
        onOpenChange={anime.setShowAniListRemap}
        seriesId={series.id}
        seriesTitle={series.title}
        instanceId={instance}
        mapping={anime.animeMapping}
        details={anime.animeDetails}
        onUpdated={anime.handleAniListUpdated}
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
          posterUrl,
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
            posterUrl,
            overview: series.overview ?? null,
            instanceId: instance ?? null,
            href: `/series/${series.id}${instance ? `?instance=${instance}` : ''}`,
            releaseDate: alertReleaseDate,
          }}
        />
      )}

      {/* Monitor edit drawer */}
      <SeriesMonitorDrawer title={series.title} actions={actions} />

      {/* Delete confirmation drawer */}
      <SeriesDeleteDrawer title={series.title} open={showDelete} onOpenChange={setShowDelete} actions={actions} />

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
