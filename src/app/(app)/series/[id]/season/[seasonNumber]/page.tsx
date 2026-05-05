'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { PageHeader } from '@/components/layout/page-header';
import {
  Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription, DrawerClose,
} from '@/components/ui/drawer';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { PageSpinner } from '@/components/ui/page-spinner';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import {
  Bookmark, BookmarkCheck, MoreHorizontal, Search, RefreshCw, Trash2, Loader2, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, DiscoverSeasonDetailResponse } from '@/types';
import { toCachedImageSrc } from '@/lib/image';
import {
  getSeasonDetailSnapshot,
  getSeriesDetailSnapshot,
  patchEpisodeAcrossSnapshots,
  patchEpisodesAcrossSnapshots,
  patchSeasonAcrossSnapshots,
  setSeasonDetailSnapshot,
  setSeriesDetailSnapshot,
} from '@/lib/series-route-cache';

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

  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [showDeleteDrawer, setShowDeleteDrawer] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);
  const [tmdbSeason, setTmdbSeason] = useState<DiscoverSeasonDetailResponse | null>(null);

  const persistSeasonSnapshot = useCallback((next: {
    series?: SonarrSeries | null;
    episodes?: SonarrEpisode[];
  } = {}) => {
    if (!Number.isFinite(seriesId) || !Number.isFinite(seasonNumber)) return;
    setSeasonDetailSnapshot(seriesId, seasonNumber, {
      series: next.series ?? series,
      episodes: next.episodes ?? episodes,
    });
  }, [episodes, seasonNumber, series, seriesId]);

  const fetchData = useCallback(async (hasCachedData: boolean) => {
    if (!Number.isFinite(seriesId) || !Number.isFinite(seasonNumber)) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    try {
      const [seriesRes, episodesRes] = await Promise.all([
        fetch(`/api/sonarr/${seriesId}`),
        fetch(`/api/sonarr/${seriesId}/episodes`),
      ]);

      const nextSeries: SonarrSeries | null = seriesRes.ok ? await seriesRes.json() : null;
      const allEpisodes: SonarrEpisode[] = episodesRes.ok ? await episodesRes.json() : [];
      const nextSeasonEpisodes = allEpisodes
        .filter((e) => e.seasonNumber === seasonNumber)
        .sort((a, b) => a.episodeNumber - b.episodeNumber);

      setSeries(nextSeries);
      setEpisodes(nextSeasonEpisodes);

      setSeasonDetailSnapshot(seriesId, seasonNumber, {
        series: nextSeries,
        episodes: nextSeasonEpisodes,
      });

      const seriesSnapshot = getSeriesDetailSnapshot(seriesId);
      if (seriesSnapshot) {
        setSeriesDetailSnapshot(seriesId, {
          series: nextSeries ?? seriesSnapshot.series,
          episodes: allEpisodes.length ? allEpisodes : seriesSnapshot.episodes,
          qualityProfiles: seriesSnapshot.qualityProfiles,
          rootFolders: seriesSnapshot.rootFolders,
          tags: seriesSnapshot.tags,
        });
      }
    } catch {
      if (!hasCachedData) {
        toast.error('Failed to load season data');
      }
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [seasonNumber, seriesId]);

  useEffect(() => {
    const cached = (
      Number.isFinite(seriesId) && Number.isFinite(seasonNumber)
    ) ? getSeasonDetailSnapshot(seriesId, seasonNumber) : null;

    if (cached) {
      setSeries(cached.series);
      setEpisodes(cached.episodes);
      setLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setRefreshing(false);
    }

    void fetchData(Boolean(cached));
  }, [fetchData, seasonNumber, seriesId]);

  // Background-fetch TMDB season data for episode images/ratings (skip for anime)
  useEffect(() => {
    if (!series?.tmdbId || series.seriesType === 'anime') {
      setTmdbSeason(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/discover/tv/${series.tmdbId}/season/${seasonNumber}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DiscoverSeasonDetailResponse | null) => setTmdbSeason(data))
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTmdbSeason(null);
      });
    return () => controller.abort();
  }, [series?.tmdbId, series?.seriesType, seasonNumber]);

  const seasonData = series?.seasons.find((s) => s.seasonNumber === seasonNumber);
  const isSeasonMonitored = seasonData?.monitored ?? true;
  const totalSize = seasonData?.statistics?.sizeOnDisk || 0;

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
    } catch {
      toast.error('Refresh failed');
    } finally {
      setActionLoading('');
    }
  }

  async function handleAutomaticSearch() {
    if (!series) return;
    setActionLoading('search');
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'SeasonSearch', seriesId: series.id, seasonNumber }),
      });
      toast.success(`Season ${seasonNumber} search started`);
    } catch {
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
      const res = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      if (res.ok) {
        const updated: SonarrSeries = await res.json();
        setSeries(updated);
        persistSeasonSnapshot({ series: updated });
        const updatedSeason = updated.seasons.find((s) => s.seasonNumber === seasonNumber);
        if (updatedSeason) {
          patchSeasonAcrossSnapshots(updated.id, seasonNumber, () => updatedSeason);
        }
        toast.success(isSeasonMonitored ? 'Season unmonitored' : 'Season monitored');
      }
    } catch {
      toast.error('Failed to update season');
    } finally {
      setActionLoading('');
    }
  }

  async function handleToggleEpisodeMonitor(episodeId: number, monitored: boolean) {
    try {
      const res = await fetch('/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [episodeId], monitored }),
      });
      if (res.ok) {
        setEpisodes((prev) => {
          const nextEpisodes = prev.map((e) => (e.id === episodeId ? { ...e, monitored } : e));
          persistSeasonSnapshot({ episodes: nextEpisodes });
          return nextEpisodes;
        });
        patchEpisodeAcrossSnapshots(seriesId, episodeId, (episode) => ({ ...episode, monitored }));
      }
    } catch {
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
        const unmonitorEpisodesRes = await fetch('/api/sonarr/episode/monitor', {
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
      const updateSeasonRes = await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
      const nextEpisodes = episodes.map((episode) => ({ ...episode, monitored: false }));
      setEpisodes(nextEpisodes);
      persistSeasonSnapshot({ episodes: nextEpisodes });
      patchEpisodesAcrossSnapshots(
        seriesId,
        nextEpisodes.map((episode) => ({
          episodeId: episode.id,
          updater: (existing) => ({ ...existing, monitored: false }),
        }))
      );
      if (updateSeasonRes.ok) {
        const updated: SonarrSeries = await updateSeasonRes.json();
        setSeries(updated);
        persistSeasonSnapshot({ series: updated, episodes: nextEpisodes });
        const updatedSeason = updated.seasons.find((s) => s.seasonNumber === seasonNumber);
        if (updatedSeason) {
          patchSeasonAcrossSnapshots(updated.id, seasonNumber, () => updatedSeason);
        }
      } else {
        patchSeasonAcrossSnapshots(seriesId, seasonNumber, (current) => ({ ...current, monitored: false }));
      }
      toast.success('Season unmonitored');
      setShowDeleteDrawer(false);
      router.back();
    } catch {
      toast.error('Failed to unmonitor season');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <><PageHeader title="Season" /><PageSpinner /></>;
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const seasonTitle = seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;
  const fileCount = episodes.filter((e) => e.hasFile).length;

  return (
    <div className="space-y-4 animate-content-in">
      <PageHeader
        subtitle={<Link href={`/series/${seriesId}`} className="hover:underline">{series.title}</Link>}
        title={seasonTitle}
        onBack={() => router.push(`/series/${seriesId}`)}
        rightContent={
          <div className="flex items-center gap-1">
            {refreshing && !loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
            )}
            {/* Monitor toggle */}
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
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  onClick={() => setShowDeleteDrawer(true)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Unmonitor Season
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Status strip */}
      <div className="flex items-center gap-2">
        <span className="marquee-dot" aria-hidden />
        <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85">
          {isSeasonMonitored ? 'Monitored' : 'Idle'} · Season {seasonNumber}
        </span>
        <span className="hairline flex-1" aria-hidden />
        <span className="tracked-caps text-[9px] text-muted-foreground/70 font-mono tabular" style={{ letterSpacing: '0.22em' }}>
          {fileCount}/{episodes.length}
        </span>
      </div>

      {/* Metadata grid */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-card/40 border border-[color:var(--hairline)] px-3 py-2.5" style={{ borderRadius: 'calc(var(--radius) - 2px)' }}>
          <p className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.22em' }}>Year</p>
          <p className="font-mono tabular text-[15px] mt-0.5">{series.year || '—'}</p>
        </div>
        <div className="bg-card/40 border border-[color:var(--hairline)] px-3 py-2.5" style={{ borderRadius: 'calc(var(--radius) - 2px)' }}>
          <p className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.22em' }}>Runtime</p>
          <p className="font-mono tabular text-[15px] mt-0.5">{series.runtime > 0 ? `${series.runtime}m` : '—'}</p>
        </div>
        <div className="bg-card/40 border border-[color:var(--hairline)] px-3 py-2.5" style={{ borderRadius: 'calc(var(--radius) - 2px)' }}>
          <p className="tracked-caps text-[8.5px] text-muted-foreground/80" style={{ letterSpacing: '0.22em' }}>On disk</p>
          <p className="font-mono tabular text-[13px] mt-0.5 text-[color:var(--amber)]">{formatBytes(totalSize)}</p>
        </div>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <Button
          className="flex-1 h-11 cta-sheen projector-glow"
          onClick={handleAutomaticSearch}
          disabled={!!actionLoading}
        >
          {actionLoading === 'search' ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Search className="h-4 w-4" />
          )}
          <span className="tracked-caps text-[10px]">Auto Search</span>
        </Button>
        <Button
          variant="outline"
          className="flex-1 h-11"
          onClick={() => setInteractiveSearch(true)}
        >
          <Search className="h-4 w-4" />
          <span className="tracked-caps text-[10px]">Interactive</span>
        </Button>
      </div>

      {/* Episodes header */}
      <div className="flex items-center gap-2 pt-2">
        <span className="reel" aria-hidden />
        <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
          Episodes · {episodes.length}
        </h2>
        <span className="hairline flex-1" aria-hidden />
      </div>

      {/* Episode list */}
      <div className="border-t border-b border-[color:var(--hairline)]">
        {episodes.map((ep) => {
          const isFinale = ep.episodeNumber === episodes.length && episodes.length > 1;
          const isPremiere = ep.episodeNumber === 1;
          const tmdbEp = tmdbSeason?.episodes.find((e) => e.episodeNumber === ep.episodeNumber);

          return (
            <Link
              key={ep.id}
              href={`/series/${id}/season/${seasonNumber}/episode/${ep.id}`}
              className="group flex gap-3 px-1 py-3 border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/30 transition-colors"
            >
              {/* Reel number column */}
              <div className="w-10 shrink-0 flex flex-col items-center pt-1">
                <span className="font-mono tabular text-[11px] text-[color:var(--amber)]/80 tracked-mid" style={{ letterSpacing: '0.18em' }}>
                  E{String(ep.episodeNumber || 0).padStart(2, '0')}
                </span>
              </div>

              {series?.seriesType !== 'anime' && (
                tmdbEp?.stillPath ? (
                  <div
                    className="relative w-[110px] h-[62px] overflow-hidden shrink-0 bg-muted/40"
                    style={{ borderRadius: 'calc(var(--radius) - 2px)', boxShadow: '0 0 0 1px var(--hairline)' }}
                  >
                    <Image
                      src={toCachedImageSrc(tmdbEp.stillPath, 'tmdb') || tmdbEp.stillPath}
                      alt=""
                      fill
                      sizes="110px"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.05]"
                      unoptimized
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-[color:var(--ink-deep)]/50 to-transparent" />
                  </div>
                ) : (
                  <div
                    className="w-[110px] h-[62px] bg-muted/40 flex items-center justify-center shrink-0"
                    style={{ borderRadius: 'calc(var(--radius) - 2px)', boxShadow: '0 0 0 1px var(--hairline)' }}
                  >
                    <span className="font-display text-[20px] text-muted-foreground/70">{ep.episodeNumber}</span>
                  </div>
                )
              )}

              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <h3 className="font-display text-[14px] sm:text-[15px] leading-tight truncate group-hover:text-[color:var(--amber)] transition-colors" style={{ letterSpacing: '-0.012em' }}>
                    {ep.title || 'TBA'}
                  </h3>
                  {isPremiere && (
                    <span className="tracked-caps text-[8px] px-1.5 py-0.5 bg-[color:var(--amber-soft)] text-[color:var(--amber)]" style={{ borderRadius: '3px', letterSpacing: '0.2em' }}>
                      Premiere
                    </span>
                  )}
                  {isFinale && (
                    <span className="tracked-caps text-[8px] px-1.5 py-0.5 bg-[color:var(--amber-soft)] text-[color:var(--amber)]" style={{ borderRadius: '3px', letterSpacing: '0.2em' }}>
                      Finale
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-1 flex-wrap">
                  {ep.hasFile ? (
                    <span
                      className="inline-flex items-center gap-1 tracked-caps text-[8.5px] px-1.5 py-0.5 border"
                      style={{
                        borderRadius: '3px',
                        letterSpacing: '0.22em',
                        background: 'oklch(0.78 0.13 162 / 0.16)',
                        borderColor: 'oklch(0.78 0.13 162 / 0.4)',
                        color: 'oklch(0.78 0.13 162)',
                      }}
                    >
                      <span className="inline-block h-1 w-1 rounded-full" style={{ background: 'oklch(0.78 0.13 162)' }} />
                      Downloaded
                    </span>
                  ) : ep.monitored ? (
                    <span
                      className="inline-flex items-center gap-1 tracked-caps text-[8.5px] px-1.5 py-0.5 border"
                      style={{
                        borderRadius: '3px',
                        letterSpacing: '0.22em',
                        background: 'oklch(0.66 0.20 25 / 0.16)',
                        borderColor: 'oklch(0.66 0.20 25 / 0.4)',
                        color: 'oklch(0.78 0.18 25)',
                      }}
                    >
                      <span className="inline-block h-1 w-1 rounded-full" style={{ background: 'oklch(0.66 0.20 25)' }} />
                      Missing
                    </span>
                  ) : null}
                  {ep.airDate && (
                    <span className="font-mono tabular text-[10px] text-muted-foreground/80">
                      {format(new Date(ep.airDate), 'MMM d, yyyy')}
                    </span>
                  )}
                  {tmdbEp && tmdbEp.runtime && (
                    <span className="font-mono tabular text-[10px] text-muted-foreground/70">{tmdbEp.runtime}m</span>
                  )}
                  {tmdbEp && tmdbEp.voteAverage > 0 && (
                    <span className="inline-flex items-center gap-0.5 font-mono tabular text-[10px] text-[color:var(--amber)]">
                      <Star className="h-2.5 w-2.5 fill-[color:var(--amber)]" />
                      {tmdbEp.voteAverage.toFixed(1)}
                    </span>
                  )}
                </div>
                {tmdbEp?.overview && (
                  <p className="text-[12px] text-muted-foreground/85 line-clamp-2 mt-1.5 leading-snug">{tmdbEp.overview}</p>
                )}
              </div>

              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleToggleEpisodeMonitor(ep.id, !ep.monitored);
                }}
                className="press-feedback min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0 self-center"
              >
                {ep.monitored ? (
                  <BookmarkCheck className="h-4 w-4 text-[color:var(--amber)]" />
                ) : (
                  <Bookmark className="h-4 w-4 text-muted-foreground/60" />
                )}
              </button>
            </Link>
          );
        })}

        {episodes.length === 0 && (
          <div className="px-4 py-12 text-center">
            <p className="tracked-caps text-[10px] text-muted-foreground">No episodes</p>
            <p className="font-display text-[16px] mt-1.5">Reel not yet pressed.</p>
          </div>
        )}
      </div>

      {/* Interactive Search Dialog */}
      <InteractiveSearchDialog
        open={interactiveSearch}
        onOpenChange={setInteractiveSearch}
        title={`${series.title} - ${seasonTitle}`}
        service="sonarr"
        searchParams={{ seriesId: series.id, seasonNumber }}
        showSeasonPackFilter
      />

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
