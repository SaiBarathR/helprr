'use client';

import { useEffect, useState, useCallback } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
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
  Bookmark, BookmarkCheck, MoreHorizontal, Search, RefreshCw, Trash2, Loader2, Info,
  ExternalLink, Star,
} from 'lucide-react';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import type { EpisodeWithFile, HistoryItem, SonarrEpisodeFile, SonarrSeries, DiscoverSeasonDetailResponse, DiscoverSeasonEpisode } from '@/types';
import { toCachedImageSrc } from '@/lib/image';
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

function formatBitrate(value?: string | number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)} mbps`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)} kbps`;
  return `${value} bps`;
}

function formatRuntime(value?: string | number): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'string') return value;
  if (!Number.isFinite(value) || value <= 0) return null;
  const totalSeconds = Math.floor(value);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

type DrawerRow = { label: string; value: string; breakValue?: boolean };

function DetailRows({ rows }: { rows: DrawerRow[] }) {
  return (
    <div className="rounded-lg border overflow-hidden divide-y">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="flex justify-between items-start px-4 py-2.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide">{row.label}</span>
          <span className={`text-sm text-right ml-4 ${row.breakValue ? 'break-all' : ''}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

function buildEpisodeDrawerData(episodeFile: SonarrEpisodeFile): {
  infoRows: DrawerRow[];
  vidRows: DrawerRow[];
  audRows: DrawerRow[];
} {
  const mediaInfo = episodeFile.mediaInfo;
  const qualityName = episodeFile.quality?.quality?.name ?? 'Unknown';
  const fileLanguages = episodeFile.languages?.length
    ? episodeFile.languages.map((language) => language.name).join(', ')
    : episodeFile.language?.name ?? '';
  const audioLanguages = mediaInfo?.audioLanguages || fileLanguages;
  const subtitles = mediaInfo?.subtitles?.trim() ? mediaInfo.subtitles : 'None';
  const runtime = formatRuntime(mediaInfo?.runTime);
  const videoBitrate = formatBitrate(mediaInfo?.videoBitrate);
  const audioBitrate = formatBitrate(mediaInfo?.audioBitrate);

  const infoRows: DrawerRow[] = [
    ...(episodeFile.relativePath
      ? [{ label: 'Filename', value: episodeFile.relativePath, breakValue: true }]
      : []),
    { label: 'File Size', value: formatBytes(episodeFile.size) },
    { label: 'Quality', value: qualityName },
    ...(fileLanguages ? [{ label: 'Language', value: fileLanguages }] : []),
    ...(episodeFile.path ? [{ label: 'Path', value: episodeFile.path, breakValue: true }] : []),
  ];

  const vidRows: DrawerRow[] = [
    ...(runtime ? [{ label: 'Runtime', value: runtime }] : []),
    ...(mediaInfo?.resolution ? [{ label: 'Resolution', value: mediaInfo.resolution }] : []),
    ...(mediaInfo?.videoCodec ? [{ label: 'Codec', value: mediaInfo.videoCodec.toUpperCase() }] : []),
    ...(mediaInfo?.videoDynamicRangeType
      ? [{ label: 'Dynamic Range Type', value: mediaInfo.videoDynamicRangeType }]
      : []),
    ...(videoBitrate ? [{ label: 'Bitrate', value: videoBitrate }] : []),
    ...(mediaInfo?.videoFps !== undefined && mediaInfo.videoFps !== null
      ? [{ label: 'Framerate', value: `${mediaInfo.videoFps} fps` }]
      : []),
    ...(mediaInfo?.videoBitDepth !== undefined && mediaInfo.videoBitDepth !== null
      ? [{ label: 'Color Depth', value: `${mediaInfo.videoBitDepth} bit` }]
      : []),
    ...(mediaInfo?.scanType ? [{ label: 'Scan Type', value: mediaInfo.scanType }] : []),
  ];

  const audRows: DrawerRow[] = [
    ...(mediaInfo?.audioCodec ? [{ label: 'Codec', value: mediaInfo.audioCodec.toUpperCase() }] : []),
    ...(mediaInfo?.audioChannels !== undefined && mediaInfo.audioChannels !== null
      ? [{ label: 'Channels', value: String(mediaInfo.audioChannels) }]
      : []),
    ...(audioBitrate ? [{ label: 'Bitrate', value: audioBitrate }] : []),
    ...(audioLanguages ? [{ label: 'Languages', value: audioLanguages }] : []),
    ...(mediaInfo?.audioStreamCount !== undefined && mediaInfo.audioStreamCount !== null
      ? [{ label: 'Stream Count', value: String(mediaInfo.audioStreamCount) }]
      : []),
    ...(mediaInfo ? [{ label: 'Subtitles', value: subtitles }] : []),
  ];

  return { infoRows, vidRows, audRows };
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

export default function EpisodeDetailPage() {
  const { id, seasonNumber: seasonNumberParam, episodeId: episodeIdParam } = useParams();
  const router = useRouter();
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
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const [tmdbEpisode, setTmdbEpisode] = useState<DiscoverSeasonEpisode | null>(null);
  const episodeNumber = episode?.episodeNumber;

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
      setEpisode(cached.episode);
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

  // Background-fetch TMDB episode data for still image and rating (skip for anime)
  useEffect(() => {
    if (!series?.tmdbId || !episodeNumber || series.seriesType === 'anime') {
      setTmdbEpisode(null);
      return;
    }
    const controller = new AbortController();
    fetch(`/api/discover/tv/${series.tmdbId}/season/${seasonNumber}`, { signal: controller.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((data: DiscoverSeasonDetailResponse | null) => {
        const match = data?.episodes.find((e) => e.episodeNumber === episodeNumber) ?? null;
        setTmdbEpisode(match);
      })
      .catch((err: unknown) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setTmdbEpisode(null);
      });
    return () => controller.abort();
  }, [episodeNumber, seasonNumber, series?.seriesType, series?.tmdbId]);

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
      const deleteRes = await fetch(`/api/sonarr/episodefile/${episode.episodeFileId}`, {
        method: 'DELETE',
      });
      if (!deleteRes.ok) {
        let message = 'Failed to delete episode file';
        try {
          const body = await deleteRes.json();
          if (typeof body?.error === 'string' && body.error) {
            message = body.error;
          }
        } catch {
          // Keep fallback message.
        }
        throw new Error(message);
      }

      toast.success('Episode file deleted');
      setShowDeleteDrawer(false);
      const nextEpisode = {
        ...episode,
        hasFile: false,
        episodeFileId: 0,
        episodeFile: undefined,
      };
      setEpisode(nextEpisode);
      setEpisodeDetailSnapshot(seriesId, episodeId, {
        series,
        episode: nextEpisode,
        history,
      });
      patchEpisodeAcrossSnapshots(seriesId, episodeId, (current) => ({
        ...current,
        hasFile: false,
        episodeFileId: 0,
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to delete file';
      toast.error(message);
    } finally {
      setDeleting(false);
    }
  }

  if (loading) {
    return <><PageHeader title="Episode" /><PageSpinner /></>;
  }

  if (!series || !episode) {
    return <div className="text-center py-12 text-muted-foreground">Episode not found</div>;
  }

  const episodeFile = episode.episodeFile;
  const mediaInfo = episodeFile?.mediaInfo;
  const epCode = `S${String(episode.seasonNumber).padStart(2, '0')}E${String(episode.episodeNumber).padStart(2, '0')}`;

  return (
    <div className="space-y-4 animate-content-in">
      <PageHeader
        subtitle={
          <span className="flex items-center gap-1 truncate">
            <Link href={`/series/${seriesId}`} className="hover:underline truncate">{series.title}</Link>
            <span className="text-muted-foreground/40 shrink-0">/</span>
            <Link href={`/series/${seriesId}/season/${seasonNumber}`} className="hover:underline shrink-0">S{String(seasonNumber).padStart(2, '0')}</Link>
          </span>
        }
        title={episode.title || 'TBA'}
        onBack={() => router.push(`/series/${seriesId}/season/${seasonNumber}`)}
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

      {/* Episode still image — cinematic hero */}
      {tmdbEpisode?.stillPath ? (
        <div className="relative -mx-3 md:-mx-8 w-[calc(100%+1.5rem)] md:w-[calc(100%+4rem)] h-[220px] sm:h-[280px] lg:h-[340px] overflow-hidden bg-[color:var(--ink-deep)]">
          <Image
            src={toCachedImageSrc(tmdbEpisode.stillPath, 'tmdb') || tmdbEpisode.stillPath}
            alt=""
            fill
            sizes="100vw"
            className="object-cover animate-hero-zoom"
            priority
            unoptimized
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent" />
          <div aria-hidden className="cinema-grain" />
          <div className="absolute top-3 left-3 md:left-8 right-3 md:right-8 flex items-center gap-2">
            <span className="marquee-dot" aria-hidden />
            <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/90">
              Episode · {epCode}
            </span>
            <span className="hairline flex-1" aria-hidden />
            <span className="tracked-caps text-[9.5px] text-white/70 font-mono tabular hidden sm:inline" style={{ letterSpacing: '0.22em' }}>
              {episode.hasFile ? 'On Disk' : episode.monitored ? 'Awaiting' : 'Idle'}
            </span>
          </div>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <span className="marquee-dot" aria-hidden />
          <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85">Episode · {epCode}</span>
          <span className="hairline flex-1" aria-hidden />
        </div>
      )}

      {/* Status pill row */}
      <div className="flex items-center gap-2 flex-wrap">
        {episode.hasFile ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 tracked-caps text-[9px] border"
            style={{
              borderRadius: '3px',
              letterSpacing: '0.22em',
              background: 'oklch(0.78 0.13 162 / 0.16)',
              borderColor: 'oklch(0.78 0.13 162 / 0.4)',
              color: 'oklch(0.78 0.13 162)',
            }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'oklch(0.78 0.13 162)' }} />
            Downloaded
          </span>
        ) : episode.monitored ? (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 tracked-caps text-[9px] border"
            style={{
              borderRadius: '3px',
              letterSpacing: '0.22em',
              background: 'oklch(0.66 0.20 25 / 0.16)',
              borderColor: 'oklch(0.66 0.20 25 / 0.4)',
              color: 'oklch(0.78 0.18 25)',
            }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full" style={{ background: 'oklch(0.66 0.20 25)' }} />
            Missing
          </span>
        ) : (
          <span
            className="inline-flex items-center gap-1.5 px-2 py-0.5 tracked-caps text-[9px] border border-[color:var(--hairline)] bg-card/40 text-muted-foreground"
            style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
          >
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-muted-foreground/50" />
            Unmonitored
          </span>
        )}
        {tmdbEpisode && tmdbEpisode.voteAverage > 0 && (
          <span className="inline-flex items-center gap-1 font-mono tabular text-[12px] text-[color:var(--amber)]">
            <Star className="h-3 w-3 fill-[color:var(--amber)]" />
            {tmdbEpisode.voteAverage.toFixed(1)}
          </span>
        )}
        <span className="font-mono tabular tracked-mid text-[10px] text-muted-foreground/85" style={{ letterSpacing: '0.16em' }}>
          {[
            tmdbEpisode?.runtime || series.runtime > 0 ? `${tmdbEpisode?.runtime || series.runtime} MIN` : null,
            episode.airDate ? format(new Date(episode.airDate), 'MMM d, yyyy').toUpperCase() : null,
          ].filter(Boolean).join('  ·  ')}
        </span>
      </div>

      {/* Metadata rows */}
      <div className="border-t border-b border-[color:var(--hairline)]">
        {series.network && (
          <div className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)]">
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Network</span>
            <span className="text-[13px] font-mono tabular truncate">{series.network}</span>
          </div>
        )}
        {series.genres && series.genres.length > 0 && (
          <div className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)]">
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Genre</span>
            <span className="text-[13px] truncate max-w-[60%]">{series.genres.join(' · ')}</span>
          </div>
        )}
        {mediaInfo?.videoCodec && (
          <div className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)]">
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Video</span>
            <span className="text-[13px] font-mono tabular text-right truncate">
              {mediaInfo.videoCodec}
              {mediaInfo.resolution ? ` · ${mediaInfo.resolution}` : ''}
              {mediaInfo.videoDynamicRangeType ? ` · ${mediaInfo.videoDynamicRangeType}` : ''}
            </span>
          </div>
        )}
        {mediaInfo?.audioCodec && (
          <div className="flex justify-between items-baseline gap-3 py-2.5 border-b border-[color:var(--hairline)]">
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Audio</span>
            <span className="text-[13px] font-mono tabular text-right truncate">
              {mediaInfo.audioCodec}
              {mediaInfo.audioChannels ? ` · ${mediaInfo.audioChannels}ch` : ''}
              {mediaInfo.audioLanguages ? ` (${mediaInfo.audioLanguages})` : ''}
            </span>
          </div>
        )}
        {mediaInfo?.subtitles && (
          <div className="flex justify-between items-baseline gap-3 py-2.5">
            <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Subtitles</span>
            <span className="text-[13px] font-mono tabular truncate max-w-[60%]">{mediaInfo.subtitles}</span>
          </div>
        )}
        {!mediaInfo && !series.network && (!series.genres || series.genres.length === 0) && (
          <div className="px-1 py-3 text-sm text-muted-foreground text-center">
            No metadata available
          </div>
        )}
      </div>

      {/* Overview */}
      {episode.overview && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="reel" aria-hidden />
            <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
              Synopsis
            </h2>
            <span className="hairline flex-1" aria-hidden />
          </div>
          <p className="text-[14px] text-foreground/85 leading-relaxed pl-1">{episode.overview}</p>
        </div>
      )}

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

      {/* File section */}
      {episode.hasFile && episodeFile && (
        <div className="space-y-2">
          <div className="flex items-center gap-2">
            <span className="reel" aria-hidden />
            <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
              File · On Disk
            </h2>
            <span className="hairline flex-1" aria-hidden />
            <button
              onClick={() => setFileDrawerOpen(true)}
              type="button"
              aria-label="Open file details"
              aria-expanded={fileDrawerOpen}
              aria-controls="episode-file-details-drawer"
              className="press-feedback min-w-[36px] min-h-[36px] inline-flex items-center justify-center hover:text-[color:var(--amber)] transition-colors"
              title="File details"
            >
              <Info className="h-4 w-4 text-muted-foreground" />
            </button>
          </div>
          <div
            className="border border-[color:var(--hairline)] bg-card/40"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
          >
            <div className="px-3.5 py-2.5 border-b border-[color:var(--hairline)]">
              <span className="tracked-caps text-[8.5px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Filename</span>
              <p className="font-mono tabular text-[12px] mt-0.5 break-all leading-tight text-foreground/90">
                {episodeFile.relativePath || episodeFile.path}
              </p>
            </div>
            <div className="flex justify-between items-baseline gap-3 px-3.5 py-2.5 border-b border-[color:var(--hairline)]">
              <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Quality</span>
              <span className="tracked-caps text-[10px] text-[color:var(--amber)]">{episodeFile.quality?.quality?.name || 'Unknown'}</span>
            </div>
            {episodeFile.languages && episodeFile.languages.length > 0 && (
              <div className="flex justify-between items-baseline gap-3 px-3.5 py-2.5 border-b border-[color:var(--hairline)]">
                <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Language</span>
                <span className="text-[12.5px]">
                  {episodeFile.languages.map((l) => l.name).join(' · ')}
                </span>
              </div>
            )}
            {!episodeFile.languages && episodeFile.language && (
              <div className="flex justify-between items-baseline gap-3 px-3.5 py-2.5 border-b border-[color:var(--hairline)]">
                <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Language</span>
                <span className="text-[12.5px]">{episodeFile.language.name}</span>
              </div>
            )}
            <div className="flex justify-between items-baseline gap-3 px-3.5 py-2.5">
              <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>Size</span>
              <span className="font-mono tabular text-[12.5px] text-[color:var(--amber)]">{formatBytes(episodeFile.size)}</span>
            </div>
          </div>
        </div>
      )}

      {/* History section */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <span className="reel" aria-hidden />
          <h2 className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>
            Booth Log · History
          </h2>
          <span className="hairline flex-1" aria-hidden />
        </div>
        {historyLoading ? (
          <PageSpinner />
        ) : history.length === 0 ? (
          <div
            className="border border-[color:var(--hairline)] bg-card/40 px-4 py-8 text-center"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
          >
            <p className="tracked-caps text-[10px] text-muted-foreground">No history</p>
            <p className="font-display text-[15px] mt-1">Booth log empty.</p>
          </div>
        ) : (
          <div
            className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden"
            style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
          >
            {history.map((item) => (
              <button
                key={item.id}
                onClick={() => setSelectedHistoryItem(item)}
                className="group w-full text-left px-3.5 py-3 border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/40 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span
                    className="tracked-caps text-[8.5px] px-1.5 py-0.5 border"
                    style={{
                      borderRadius: '3px',
                      letterSpacing: '0.22em',
                      ...(eventTypeBadgeVariant(item.eventType) === 'destructive'
                        ? { background: 'oklch(0.66 0.20 25 / 0.16)', borderColor: 'oklch(0.66 0.20 25 / 0.4)', color: 'oklch(0.78 0.18 25)' }
                        : eventTypeBadgeVariant(item.eventType) === 'default'
                          ? { background: 'oklch(0.78 0.13 162 / 0.16)', borderColor: 'oklch(0.78 0.13 162 / 0.4)', color: 'oklch(0.78 0.13 162)' }
                          : { background: 'var(--amber-soft)', borderColor: 'var(--amber-soft)', color: 'var(--amber)' }),
                    }}
                  >
                    {eventTypeLabel(item.eventType)}
                  </span>
                  <span className="font-mono tabular text-[10px] text-muted-foreground/80">
                    {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-[12px] font-mono tabular text-muted-foreground/80 mt-1.5 truncate">
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

      {/* File Detail Drawer */}
      <Drawer open={fileDrawerOpen} onOpenChange={setFileDrawerOpen}>
        <DrawerContent id="episode-file-details-drawer">
          <DrawerHeader>
            <DrawerTitle>Information</DrawerTitle>
            <DrawerDescription className="break-all">
              {episodeFile?.relativePath || episode.title || 'TBA'}
            </DrawerDescription>
          </DrawerHeader>
          {episodeFile && (() => {
            const { infoRows, vidRows, audRows } = buildEpisodeDrawerData(episodeFile);

            return (
              <div className="px-4 pb-4 space-y-4 overflow-y-auto max-h-[60vh]">
                {infoRows.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Information</h3>
                    <DetailRows rows={infoRows} />
                  </div>
                )}
                {vidRows.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Video</h3>
                    <DetailRows rows={vidRows} />
                  </div>
                )}
                {audRows.length > 0 && (
                  <div className="space-y-2">
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Audio</h3>
                    <DetailRows rows={audRows} />
                  </div>
                )}
                <div className="pt-1">
                  <DrawerClose asChild>
                    <Button variant="ghost" className="w-full">Close</Button>
                  </DrawerClose>
                </div>
              </div>
            );
          })()}
        </DrawerContent>
      </Drawer>

      {/* Delete File Confirmation Drawer */}
      <Drawer open={showDeleteDrawer} onOpenChange={setShowDeleteDrawer}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete Episode File?</DrawerTitle>
            <DrawerDescription>
              This will delete the episode file. Are you sure you want to continue?
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
