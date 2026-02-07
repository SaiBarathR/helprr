'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams, useRouter } from 'next/navigation';
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
import { Skeleton } from '@/components/ui/skeleton';
import { InteractiveSearchDialog } from '@/components/media/interactive-search-dialog';
import {
  Bookmark, BookmarkCheck, MoreHorizontal, Search, RefreshCw, Trash2, Loader2, X,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import type { SonarrSeries, SonarrEpisode } from '@/types';

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
  const seasonNumber = Number(seasonNumberParam);

  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episodes, setEpisodes] = useState<SonarrEpisode[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState('');
  const [showDeleteDrawer, setShowDeleteDrawer] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [seriesRes, episodesRes] = await Promise.all([
        fetch(`/api/sonarr/${id}`),
        fetch(`/api/sonarr/${id}/episodes`),
      ]);
      if (seriesRes.ok) setSeries(await seriesRes.json());
      if (episodesRes.ok) {
        const allEpisodes: SonarrEpisode[] = await episodesRes.json();
        setEpisodes(
          allEpisodes
            .filter((e) => e.seasonNumber === seasonNumber)
            .sort((a, b) => a.episodeNumber - b.episodeNumber)
        );
      }
    } catch {
      toast.error('Failed to load season data');
    } finally {
      setLoading(false);
    }
  }, [id, seasonNumber]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

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
        const updated = await res.json();
        setSeries(updated);
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
        setEpisodes((prev) =>
          prev.map((e) => (e.id === episodeId ? { ...e, monitored } : e))
        );
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
        await fetch('/api/sonarr/episode/monitor', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ episodeIds, monitored: false }),
        });
      }
      // Unmonitor the season
      const updatedSeries = {
        ...series,
        seasons: series.seasons.map((s) =>
          s.seasonNumber === seasonNumber ? { ...s, monitored: false } : s
        ),
      };
      await fetch(`/api/sonarr/${series.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updatedSeries),
      });
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
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-6 w-48" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        {[...Array(6)].map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (!series) {
    return <div className="text-center py-12 text-muted-foreground">Series not found</div>;
  }

  const seasonTitle = seasonNumber === 0 ? 'Specials' : `Season ${seasonNumber}`;
  const fileCount = episodes.filter((e) => e.hasFile).length;

  return (
    <div className="space-y-4 pb-20">
      <PageHeader
        subtitle={series.title}
        title={seasonTitle}
        rightContent={
          <div className="flex items-center gap-1">
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

      {/* Metadata line */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-4">
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

      {/* Pill buttons */}
      <div className="flex gap-2 px-4">
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

      {/* Episode list */}
      <div className="space-y-0.5">
        {episodes.map((ep) => {
          const isFinale = ep.episodeNumber === episodes.length && episodes.length > 1;
          const isPremiere = ep.episodeNumber === 1;

          return (
            <Link
              key={ep.id}
              href={`/series/${id}/season/${seasonNumber}/episode/${ep.id}`}
              className="flex items-center gap-3 px-4 py-3 active:bg-muted/50 transition-colors"
            >
              {/* Episode number */}
              <span className="w-7 text-right text-sm font-medium text-muted-foreground shrink-0">
                {ep.episodeNumber}.
              </span>

              {/* Episode info */}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium truncate">
                    {ep.title || 'TBA'}
                  </span>
                  {isPremiere && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Premiere
                    </Badge>
                  )}
                  {isFinale && (
                    <Badge variant="secondary" className="text-[10px] shrink-0">
                      Season Finale
                    </Badge>
                  )}
                </div>
                <div className="flex items-center gap-1.5 mt-0.5">
                  {ep.hasFile && (
                    <Badge
                      variant="default"
                      className="text-[10px] bg-green-600 hover:bg-green-600"
                    >
                      {ep.hasFile ? 'DOWNLOADED' : ''}
                    </Badge>
                  )}
                  {!ep.hasFile && ep.monitored && (
                    <Badge
                      variant="destructive"
                      className="text-[10px]"
                    >
                      MISSING
                    </Badge>
                  )}
                  {ep.airDate && (
                    <span className="text-xs text-muted-foreground">
                      {format(new Date(ep.airDate), 'MMM d, yyyy')}
                    </span>
                  )}
                </div>
              </div>

              {/* Monitor bookmark */}
              <button
                onClick={(e) => {
                  e.preventDefault();
                  e.stopPropagation();
                  handleToggleEpisodeMonitor(ep.id, !ep.monitored);
                }}
                className="min-w-[36px] min-h-[36px] flex items-center justify-center shrink-0"
              >
                {ep.monitored ? (
                  <BookmarkCheck className="h-4 w-4 text-primary" />
                ) : (
                  <Bookmark className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            </Link>
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
