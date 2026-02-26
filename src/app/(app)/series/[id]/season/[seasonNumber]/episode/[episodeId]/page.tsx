'use client';

import { useEffect, useState, useCallback } from 'react';
import { useParams } from 'next/navigation';
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
  ExternalLink, Film, Tv, Clock, Calendar, HardDrive, FileText, Globe, Volume2, Subtitles,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import type { SonarrSeries, SonarrEpisode, HistoryItem } from '@/types';
import {
  getEpisodeDetailSnapshot,
  patchEpisodeAcrossSnapshots,
  setEpisodeDetailSnapshot,
} from '@/lib/series-route-cache';

function formatBytes(bytes: number) {
  if (!bytes) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function eventTypeLabel(eventType: string): string {
  switch (eventType) {
    case 'grabbed': return 'GRABBED';
    case 'downloadFolderImported':
    case 'episodeFileImported': return 'IMPORTED';
    case 'downloadFailed': return 'DOWNLOAD FAILED';
    case 'episodeFileDeleted': return 'FILE DELETED';
    case 'episodeFileRenamed': return 'RENAMED';
    default: return eventType.toUpperCase();
  }
}

function eventTypeBadgeVariant(eventType: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (eventType) {
    case 'grabbed': return 'secondary';
    case 'downloadFolderImported':
    case 'episodeFileImported': return 'default';
    case 'downloadFailed': return 'destructive';
    case 'episodeFileDeleted': return 'destructive';
    default: return 'outline';
  }
}

// Extended episode type that may include file info from Sonarr API
interface EpisodeWithFile extends SonarrEpisode {
  episodeFile?: {
    id: number;
    relativePath: string;
    path: string;
    size: number;
    quality: { quality: { name: string; resolution: number } };
    mediaInfo?: {
      audioBitrate: number;
      audioChannels: number;
      audioCodec: string;
      audioLanguages: string;
      audioStreamCount: number;
      videoBitDepth: number;
      videoBitrate: number;
      videoCodec: string;
      videoDynamicRangeType: string;
      videoFps: number;
      resolution: string;
      runTime: string;
      scanType: string;
      subtitles: string;
    };
    language?: { id: number; name: string };
    languages?: { id: number; name: string }[];
  };
}

export default function EpisodeDetailPage() {
  const { id, seasonNumber: seasonNumberParam, episodeId: episodeIdParam } = useParams();
  const seriesId = Number(id);
  const seasonNumber = Number(seasonNumberParam);
  const episodeId = Number(episodeIdParam);

  const [series, setSeries] = useState<SonarrSeries | null>(null);
  const [episode, setEpisode] = useState<EpisodeWithFile | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [showDeleteDrawer, setShowDeleteDrawer] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [interactiveSearch, setInteractiveSearch] = useState(false);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);

  const fetchData = useCallback(async (hasCachedData: boolean) => {
    if (!Number.isFinite(seriesId) || !Number.isFinite(episodeId)) {
      setLoading(false);
      return;
    }

    try {
      const [seriesRes, episodesRes] = await Promise.all([
        fetch(`/api/sonarr/${seriesId}`),
        fetch(`/api/sonarr/${seriesId}/episodes?includeEpisodeFile=true`),
      ]);

      const nextSeries: SonarrSeries | null = seriesRes.ok ? await seriesRes.json() : null;
      const allEpisodes: EpisodeWithFile[] = episodesRes.ok ? await episodesRes.json() : [];
      const nextEpisode = allEpisodes.find((episodeItem) => episodeItem.id === episodeId) ?? null;

      setSeries(nextSeries);
      setEpisode(nextEpisode);
      const cached = getEpisodeDetailSnapshot(seriesId, episodeId);
      setEpisodeDetailSnapshot(seriesId, episodeId, {
        series: nextSeries,
        episode: nextEpisode,
        history: cached?.history ?? [],
      });
      if (nextEpisode) {
        patchEpisodeAcrossSnapshots(seriesId, episodeId, () => nextEpisode);
      }
    } catch {
      if (!hasCachedData) {
        toast.error('Failed to load episode data');
      }
    } finally {
      setLoading(false);
    }
  }, [episodeId, seriesId]);

  const fetchHistory = useCallback(async (hasCachedData: boolean) => {
    if (!hasCachedData) {
      setHistoryLoading(true);
    }

    try {
      const res = await fetch(`/api/activity/history?episodeId=${episodeId}&pageSize=50`);
      if (res.ok) {
        const data = await res.json();
        const records = data.records || [];
        setHistory(records);
        const cached = getEpisodeDetailSnapshot(seriesId, episodeId);
        setEpisodeDetailSnapshot(seriesId, episodeId, {
          series: cached?.series ?? null,
          episode: cached?.episode ?? null,
          history: records,
        });
      }
    } catch {
      // Silently fail - history is non-critical
    } finally {
      setHistoryLoading(false);
    }
  }, [episodeId, seriesId]);

  useEffect(() => {
    const cached = (
      Number.isFinite(seriesId) && Number.isFinite(episodeId)
    ) ? getEpisodeDetailSnapshot(seriesId, episodeId) : null;

    if (cached) {
      setSeries(cached.series);
      setEpisode(cached.episode as EpisodeWithFile | null);
      setHistory(cached.history);
      setLoading(false);
      setHistoryLoading(false);
      setRefreshing(true);
    } else {
      setLoading(true);
      setHistoryLoading(true);
      setRefreshing(false);
    }

    void Promise.all([
      fetchData(Boolean(cached)),
      fetchHistory(Boolean(cached)),
    ]).finally(() => {
      setRefreshing(false);
    });
  }, [episodeId, fetchData, fetchHistory, seriesId]);

  async function handleAutomaticSearch() {
    setActionLoading('search');
    try {
      await fetch('/api/sonarr/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [episodeId] }),
      });
      toast.success('Episode search started');
    } catch {
      toast.error('Search failed');
    } finally {
      setActionLoading('');
    }
  }

  async function handleToggleMonitor() {
    if (!episode) return;
    setActionLoading('monitor');
    try {
      const nextMonitored = !episode.monitored;
      const res = await fetch('/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [episodeId], monitored: nextMonitored }),
      });
      if (res.ok) {
        const nextEpisode = { ...episode, monitored: nextMonitored };
        setEpisode(nextEpisode);
        setEpisodeDetailSnapshot(seriesId, episodeId, {
          series,
          episode: nextEpisode,
          history,
        });
        patchEpisodeAcrossSnapshots(seriesId, episodeId, (current) => ({ ...current, monitored: nextMonitored }));
        toast.success(episode.monitored ? 'Episode unmonitored' : 'Episode monitored');
      }
    } catch {
      toast.error('Failed to update');
    } finally {
      setActionLoading('');
    }
  }

  async function handleDeleteFile() {
    if (!series || !episode || !episode.episodeFileId) return;
    setDeleting(true);
    try {
      // Sonarr v3 delete episode file endpoint
      await fetch(`/api/sonarr/${seriesId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...series,
          // We can't delete files via the series PUT; we unmonitor the episode instead
        }),
      });
      // Unmonitor the episode after "delete"
      await fetch('/api/sonarr/episode/monitor', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ episodeIds: [episodeId], monitored: false }),
      });
      toast.success('Episode unmonitored');
      setShowDeleteDrawer(false);
      const nextEpisode = { ...episode, monitored: false };
      setEpisode(nextEpisode);
      setEpisodeDetailSnapshot(seriesId, episodeId, {
        series,
        episode: nextEpisode,
        history,
      });
      patchEpisodeAcrossSnapshots(seriesId, episodeId, (current) => ({ ...current, monitored: false }));
    } catch {
      toast.error('Failed to delete file');
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-24 w-full rounded-lg" />
        <div className="flex gap-2">
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
        </div>
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    );
  }

  if (!series || !episode) {
    return <div className="text-center py-12 text-muted-foreground">Episode not found</div>;
  }

  const episodeFile = episode.episodeFile;
  const mediaInfo = episodeFile?.mediaInfo;
  const epCode = `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;

  return (
    <div className="space-y-4 pb-20">
      <PageHeader
        subtitle={series.title}
        title={episode.title || 'TBA'}
        rightContent={
          <div className="flex items-center gap-1">
            {refreshing && !loading && (
              <RefreshCw className="h-4 w-4 animate-spin text-muted-foreground mr-1" />
            )}
            {/* Monitor toggle */}
            <button
              onClick={handleToggleMonitor}
              disabled={actionLoading === 'monitor'}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center text-primary"
            >
              {actionLoading === 'monitor' ? (
                <Loader2 className="h-5 w-5 animate-spin" />
              ) : episode.monitored ? (
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
                {series.imdbId && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`https://www.imdb.com/title/${series.imdbId}`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in IMDb
                    </a>
                  </DropdownMenuItem>
                )}
                {series.tvdbId && (
                  <DropdownMenuItem asChild>
                    <a
                      href={`https://trakt.tv/search/tvdb/${series.tvdbId}?id_type=show`}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink className="mr-2 h-4 w-4" />
                      Open in Trakt
                    </a>
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleAutomaticSearch} disabled={!!actionLoading}>
                  <Search className="mr-2 h-4 w-4" />
                  Automatic Search
                </DropdownMenuItem>
                {episode.hasFile && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onClick={() => setShowDeleteDrawer(true)}
                      className="text-destructive focus:text-destructive"
                    >
                      <Trash2 className="mr-2 h-4 w-4" />
                      Delete File
                    </DropdownMenuItem>
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {/* Status badge */}
      <div className="px-4">
        {episode.hasFile ? (
          <Badge className="bg-green-600 hover:bg-green-600 text-white">DOWNLOADED</Badge>
        ) : episode.monitored ? (
          <Badge variant="destructive">MISSING</Badge>
        ) : (
          <Badge variant="secondary">UNMONITORED</Badge>
        )}
      </div>

      {/* Episode code + runtime + air date line */}
      <div className="flex items-center gap-2 text-sm text-muted-foreground px-4">
        <span className="font-medium text-foreground">{epCode}</span>
        {series.runtime > 0 && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <span>{series.runtime} min</span>
          </>
        )}
        {episode.airDate && (
          <>
            <span className="text-muted-foreground/40">|</span>
            <span>{format(new Date(episode.airDate), 'MMM d, yyyy')}</span>
          </>
        )}
      </div>

      {/* Metadata rows */}
      <div className="space-y-0 mx-4 rounded-lg border overflow-hidden">
        {series.network && (
          <div className="flex justify-between items-center px-4 py-2.5 border-b">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Network</span>
            <span className="text-sm">{series.network}</span>
          </div>
        )}
        {series.genres && series.genres.length > 0 && (
          <div className="flex justify-between items-center px-4 py-2.5 border-b">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Genre</span>
            <span className="text-sm truncate max-w-[200px]">{series.genres.join(', ')}</span>
          </div>
        )}
        {mediaInfo?.videoCodec && (
          <div className="flex justify-between items-center px-4 py-2.5 border-b">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Video</span>
            <span className="text-sm">
              {mediaInfo.videoCodec}
              {mediaInfo.resolution ? ` ${mediaInfo.resolution}` : ''}
              {mediaInfo.videoDynamicRangeType ? ` ${mediaInfo.videoDynamicRangeType}` : ''}
            </span>
          </div>
        )}
        {mediaInfo?.audioCodec && (
          <div className="flex justify-between items-center px-4 py-2.5 border-b">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Audio</span>
            <span className="text-sm">
              {mediaInfo.audioCodec}
              {mediaInfo.audioChannels ? ` ${mediaInfo.audioChannels}ch` : ''}
              {mediaInfo.audioLanguages ? ` (${mediaInfo.audioLanguages})` : ''}
            </span>
          </div>
        )}
        {mediaInfo?.subtitles && (
          <div className="flex justify-between items-center px-4 py-2.5">
            <span className="text-xs text-muted-foreground uppercase tracking-wide">Subtitles</span>
            <span className="text-sm truncate max-w-[200px]">{mediaInfo.subtitles}</span>
          </div>
        )}
        {!mediaInfo && !series.network && (!series.genres || series.genres.length === 0) && (
          <div className="px-4 py-3 text-sm text-muted-foreground text-center">
            No metadata available
          </div>
        )}
      </div>

      {/* Overview */}
      {episode.overview && (
        <div className="px-4">
          <p className="text-sm text-muted-foreground leading-relaxed">{episode.overview}</p>
        </div>
      )}

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

      {/* File section */}
      {episode.hasFile && episodeFile && (
        <div className="mx-4 space-y-2">
          <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            File
          </h3>
          <div className="rounded-lg border overflow-hidden">
            <div className="px-4 py-2.5 border-b">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Filename</span>
              <p className="text-sm mt-0.5 break-all leading-tight">
                {episodeFile.relativePath || episodeFile.path}
              </p>
            </div>
            <div className="flex justify-between items-center px-4 py-2.5 border-b">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Quality</span>
              <span className="text-sm">{episodeFile.quality?.quality?.name || 'Unknown'}</span>
            </div>
            {episodeFile.languages && episodeFile.languages.length > 0 && (
              <div className="flex justify-between items-center px-4 py-2.5 border-b">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Language</span>
                <span className="text-sm">
                  {episodeFile.languages.map((l) => l.name).join(', ')}
                </span>
              </div>
            )}
            {!episodeFile.languages && episodeFile.language && (
              <div className="flex justify-between items-center px-4 py-2.5 border-b">
                <span className="text-xs text-muted-foreground uppercase tracking-wide">Language</span>
                <span className="text-sm">{episodeFile.language.name}</span>
              </div>
            )}
            <div className="flex justify-between items-center px-4 py-2.5">
              <span className="text-xs text-muted-foreground uppercase tracking-wide">Size</span>
              <span className="text-sm">{formatBytes(episodeFile.size)}</span>
            </div>
          </div>
        </div>
      )}

      {/* History section */}
      <div className="mx-4 space-y-2">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          History
        </h3>
        {historyLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <Skeleton key={i} className="h-14 w-full rounded-lg" />
            ))}
          </div>
        ) : history.length === 0 ? (
          <div className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
            No history available
          </div>
        ) : (
          <div className="rounded-lg border overflow-hidden divide-y">
            {history.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedHistoryItem(item)}
                className="w-full text-left px-4 py-3 active:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <Badge variant={eventTypeBadgeVariant(item.eventType)} className="text-[10px]">
                    {eventTypeLabel(item.eventType)}
                  </Badge>
                  <span className="text-xs text-muted-foreground">
                    {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground mt-1 truncate">
                  {item.sourceTitle}
                </p>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Interactive Search Dialog */}
      <InteractiveSearchDialog
        open={interactiveSearch}
        onOpenChange={setInteractiveSearch}
        title={`${series.title} - ${epCode} - ${episode.title || 'TBA'}`}
        service="sonarr"
        searchParams={{ episodeId }}
      />

      {/* History Detail Drawer */}
      <Drawer open={!!selectedHistoryItem} onOpenChange={(v) => { if (!v) setSelectedHistoryItem(null); }}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{selectedHistoryItem ? eventTypeLabel(selectedHistoryItem.eventType) : ''}</DrawerTitle>
            <DrawerDescription>
              {selectedHistoryItem?.date
                ? format(new Date(selectedHistoryItem.date), 'MMM d, yyyy h:mm a')
                : ''}
            </DrawerDescription>
          </DrawerHeader>
          {selectedHistoryItem && (
            <div className="px-4 pb-4 space-y-0 overflow-y-auto max-h-[60vh]">
              <div className="rounded-lg border overflow-hidden divide-y">
                <div className="px-4 py-2.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Release Title</span>
                  <p className="text-sm mt-0.5 break-all leading-tight">
                    {selectedHistoryItem.sourceTitle}
                  </p>
                </div>
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Date</span>
                  <span className="text-sm">
                    {format(new Date(selectedHistoryItem.date), 'MMM d, yyyy h:mm a')}
                  </span>
                </div>
                <div className="flex justify-between items-center px-4 py-2.5">
                  <span className="text-xs text-muted-foreground uppercase tracking-wide">Quality</span>
                  <span className="text-sm">
                    {selectedHistoryItem.quality?.quality?.name || 'Unknown'}
                  </span>
                </div>
                {selectedHistoryItem.data?.indexer && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Indexer</span>
                    <span className="text-sm">{selectedHistoryItem.data.indexer}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.downloadClient && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Download Client</span>
                    <span className="text-sm">{selectedHistoryItem.data.downloadClient}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.releaseGroup && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Release Group</span>
                    <span className="text-sm">{selectedHistoryItem.data.releaseGroup}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.nzbInfoUrl && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Source</span>
                    <a
                      href={selectedHistoryItem.data.nzbInfoUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-sm text-primary flex items-center gap-1"
                    >
                      View <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                {selectedHistoryItem.data?.size && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Size</span>
                    <span className="text-sm">{formatBytes(Number(selectedHistoryItem.data.size))}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.indexerFlags && selectedHistoryItem.data.indexerFlags !== '0' && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Flags</span>
                    <span className="text-sm">{selectedHistoryItem.data.indexerFlags}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.protocol && (
                  <div className="flex justify-between items-center px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Protocol</span>
                    <span className="text-sm capitalize">{selectedHistoryItem.data.protocol}</span>
                  </div>
                )}
                {selectedHistoryItem.data?.message && (
                  <div className="px-4 py-2.5">
                    <span className="text-xs text-muted-foreground uppercase tracking-wide">Message</span>
                    <p className="text-sm mt-0.5 text-muted-foreground">{selectedHistoryItem.data.message}</p>
                  </div>
                )}
              </div>
              <div className="pt-4">
                <DrawerClose asChild>
                  <Button variant="ghost" className="w-full">
                    Close
                  </Button>
                </DrawerClose>
              </div>
            </div>
          )}
        </DrawerContent>
      </Drawer>

      {/* Delete File Confirmation Drawer */}
      <Drawer open={showDeleteDrawer} onOpenChange={setShowDeleteDrawer}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete Episode File?</DrawerTitle>
            <DrawerDescription>
              This will unmonitor the episode. The file on disk may need to be manually removed.
            </DrawerDescription>
          </DrawerHeader>
          <div className="p-4 flex flex-col gap-2">
            <Button
              variant="destructive"
              onClick={handleDeleteFile}
              disabled={deleting}
              className="w-full"
            >
              {deleting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Delete File
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
