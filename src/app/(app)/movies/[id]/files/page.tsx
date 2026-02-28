'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { ExternalLink } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Skeleton } from '@/components/ui/skeleton';
import type { HistoryItem, RadarrMovie } from '@/types';
import {
  getMovieDetailSnapshot,
  setMovieDetailSnapshot,
} from '@/lib/movie-route-cache';

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
    case 'movieFileImported':
    case 'imported': return 'IMPORTED';
    case 'downloadFailed':
    case 'failed': return 'DOWNLOAD FAILED';
    case 'movieFileDeleted':
    case 'deleted': return 'FILE DELETED';
    case 'movieFileRenamed':
    case 'renamed': return 'RENAMED';
    case 'downloadIgnored':
    case 'ignored': return 'IGNORED';
    default: return eventType.toUpperCase();
  }
}

function eventTypeBadgeVariant(eventType: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (eventType) {
    case 'grabbed': return 'secondary';
    case 'downloadFolderImported':
    case 'movieFileImported':
    case 'imported': return 'default';
    case 'downloadFailed':
    case 'failed':
    case 'movieFileDeleted':
    case 'deleted': return 'destructive';
    default: return 'outline';
  }
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

function safeFormatDate(value: string | undefined, pattern: string): string | null {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return format(parsed, pattern);
}

type DrawerRow = {
  label: string;
  value: string;
  breakValue?: boolean;
};

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

export default function MovieFilesPage() {
  const { id } = useParams<{ id: string }>();
  const movieId = Number(id);
  const [movie, setMovie] = useState<RadarrMovie | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [selectedHistoryItem, setSelectedHistoryItem] = useState<HistoryItem | null>(null);
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;

    void Promise.allSettled([
      fetch(`/api/radarr/${movieId}`).then((r) => (r.ok ? r.json() : null)),
      fetch(`/api/radarr/history/movie?movieId=${movieId}`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([movieResult, historyResult]) => {
        if (cancelled) return;
        if (movieResult.status === 'fulfilled') {
          const nextMovie = movieResult.value as RadarrMovie | null;
          setMovie(nextMovie);
          if (Number.isFinite(movieId)) {
            const cached = getMovieDetailSnapshot(movieId);
            setMovieDetailSnapshot(movieId, {
              movie: nextMovie,
              qualityProfiles: cached?.qualityProfiles ?? [],
              tags: cached?.tags ?? [],
            });
          }
        }
        if (historyResult.status === 'fulfilled') {
          setHistory(Array.isArray(historyResult.value) ? historyResult.value : []);
        }
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setHistoryLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [movieId]);

  if (loading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-11 w-full" />
        <div className="px-4 space-y-2">
          <Skeleton className="h-8 w-20" />
          <Skeleton className="h-24 w-full rounded-2xl" />
        </div>
        <div className="px-4 space-y-2">
          <Skeleton className="h-8 w-24" />
          {[...Array(3)].map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>
      </div>
    );
  }

  if (!movie) {
    return (
      <div>
        <PageHeader title="Files & information" />
        <div className="text-center py-12 text-muted-foreground">Movie not found</div>
      </div>
    );
  }

  const movieFile = movie.movieFile;
  const mediaInfo = movieFile?.mediaInfo;
  const qualityName = movieFile?.quality?.quality?.name ?? 'Unknown';
  const score = movieFile?.customFormatScore ?? 0;
  const fileLanguages = movieFile?.languages?.length
    ? movieFile.languages.map((entry) => entry.name).join(', ')
    : movieFile?.language?.name ?? '';
  const audioLanguages = mediaInfo?.audioLanguages || fileLanguages;
  const subtitles = mediaInfo?.subtitles?.trim() ? mediaInfo.subtitles : 'None';
  const addedLabel = safeFormatDate(movieFile?.dateAdded, "d MMMM yyyy 'at' h:mm a")
    ?? safeFormatDate(movie.added, 'd MMMM yyyy');

  const informationRows: DrawerRow[] = [
    ...(movieFile?.relativePath
      ? [{ label: 'Filename', value: movieFile.relativePath, breakValue: true }]
      : []),
    ...(addedLabel ? [{ label: 'Added', value: addedLabel }] : []),
    ...(movieFile ? [{ label: 'File Size', value: formatBytes(movieFile.size) }] : []),
    ...(movieFile ? [{ label: 'Quality', value: qualityName }] : []),
    ...(movieFile?.releaseGroup ? [{ label: 'Release Group', value: movieFile.releaseGroup }] : []),
    ...(movieFile?.sceneName ? [{ label: 'Scene Name', value: movieFile.sceneName, breakValue: true }] : []),
    ...(movieFile?.edition ? [{ label: 'Edition', value: movieFile.edition }] : []),
    ...(movieFile ? [{ label: 'Score', value: score >= 0 ? `+${score}` : String(score) }] : []),
    ...(movieFile?.qualityCutoffNotMet !== undefined
      ? [{ label: 'Quality Cutoff Not Met', value: movieFile.qualityCutoffNotMet ? 'Yes' : 'No' }]
      : []),
    ...(movieFile?.indexerFlags !== undefined
      ? [{ label: 'Indexer Flags', value: String(movieFile.indexerFlags) }]
      : []),
    ...(movieFile?.path ? [{ label: 'Path', value: movieFile.path, breakValue: true }] : []),
    ...(movieFile?.originalFilePath
      ? [{ label: 'Original File Path', value: movieFile.originalFilePath, breakValue: true }]
      : []),
  ];

  const videoRows: DrawerRow[] = [
    ...(formatRuntime(mediaInfo?.runTime)
      ? [{ label: 'Runtime', value: formatRuntime(mediaInfo?.runTime) as string }]
      : []),
    ...(mediaInfo?.resolution ? [{ label: 'Resolution', value: mediaInfo.resolution }] : []),
    ...(mediaInfo?.videoCodec ? [{ label: 'Codec', value: mediaInfo.videoCodec.toUpperCase() }] : []),
    ...(mediaInfo?.videoDynamicRangeType
      ? [{ label: 'Dynamic Range Type', value: mediaInfo.videoDynamicRangeType }]
      : []),
    ...(mediaInfo?.videoDynamicRange
      ? [{ label: 'Dynamic Range', value: mediaInfo.videoDynamicRange }]
      : []),
    ...(formatBitrate(mediaInfo?.videoBitrate)
      ? [{ label: 'Bitrate', value: formatBitrate(mediaInfo?.videoBitrate) as string }]
      : []),
    ...(mediaInfo?.videoFps !== undefined && mediaInfo.videoFps !== null
      ? [{ label: 'Framerate', value: `${mediaInfo.videoFps} fps` }]
      : []),
    ...(mediaInfo?.videoBitDepth !== undefined && mediaInfo.videoBitDepth !== null
      ? [{ label: 'Color Depth', value: `${mediaInfo.videoBitDepth} bit` }]
      : []),
    ...(mediaInfo?.scanType ? [{ label: 'Scan Type', value: mediaInfo.scanType }] : []),
  ];

  const audioRows: DrawerRow[] = [
    ...(mediaInfo?.audioCodec ? [{ label: 'Codec', value: mediaInfo.audioCodec.toUpperCase() }] : []),
    ...(mediaInfo?.audioChannels !== undefined && mediaInfo.audioChannels !== null
      ? [{ label: 'Channels', value: String(mediaInfo.audioChannels) }]
      : []),
    ...(formatBitrate(mediaInfo?.audioBitrate)
      ? [{ label: 'Bitrate', value: formatBitrate(mediaInfo?.audioBitrate) as string }]
      : []),
    ...(audioLanguages ? [{ label: 'Languages', value: audioLanguages }] : []),
    ...(mediaInfo?.audioStreamCount !== undefined && mediaInfo.audioStreamCount !== null
      ? [{ label: 'Stream Count', value: String(mediaInfo.audioStreamCount) }]
      : []),
    ...(mediaInfo ? [{ label: 'Subtitles', value: subtitles }] : []),
  ];

  return (
    <>
      <PageHeader title={movie.title} />

      <div className="space-y-6 pb-8">
        <section className="space-y-2">
          <h2 className="text-3xl font-bold leading-tight">Files</h2>
          {movie.hasFile && movieFile ? (
            <button
              onClick={() => setFileDrawerOpen(true)}
              className="w-full rounded-2xl border bg-card p-4 text-left active:bg-muted/50 transition-colors"
            >
              <p className="text-xl font-semibold break-words leading-tight">{movieFile.relativePath}</p>
              <p className="text-sm text-muted-foreground mt-0.5">
                {[qualityName, fileLanguages, formatBytes(movieFile.size)].filter(Boolean).join(' \u00b7 ')}
              </p>
            </button>
          ) : (
            <div className="rounded-2xl border px-4 py-6 text-sm text-muted-foreground text-center">
              No file on disk
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-3xl font-bold leading-tight">History</h2>
          {historyLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-16 w-full rounded-xl" />
              ))}
            </div>
          ) : history.length === 0 ? (
            <div className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">
              No history available
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item, index) => (
                <button
                  key={`${item.id}-${item.date}-${index}`}
                  onClick={() => setSelectedHistoryItem(item)}
                  className="w-full rounded-2xl border bg-card px-4 py-3 text-left active:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={eventTypeBadgeVariant(item.eventType)} className="text-[10px]">
                      {eventTypeLabel(item.eventType)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm mt-2 break-all leading-tight">
                    {item.sourceTitle}
                  </p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {[
                      item.quality?.quality?.name,
                      item.data?.languages,
                    ].filter(Boolean).join(' \u00b7 ')}
                  </p>
                </button>
              ))}
            </div>
          )}
        </section>
      </div>

      <Drawer open={fileDrawerOpen} onOpenChange={setFileDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Information</DrawerTitle>
            <DrawerDescription className="break-all">
              {movieFile?.relativePath || movie.title}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4 overflow-y-auto max-h-[60vh]">
            {informationRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Information</h3>
                <DetailRows rows={informationRows} />
              </div>
            )}

            {videoRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Video</h3>
                <DetailRows rows={videoRows} />
              </div>
            )}

            {audioRows.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Audio</h3>
                <DetailRows rows={audioRows} />
              </div>
            )}

            {!movieFile && (
              <div className="rounded-lg border px-4 py-6 text-center text-sm text-muted-foreground">
                No file information available
              </div>
            )}

            <div className="pt-1">
              <DrawerClose asChild>
                <Button variant="ghost" className="w-full">
                  Close
                </Button>
              </DrawerClose>
            </div>
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={!!selectedHistoryItem} onOpenChange={(open) => { if (!open) setSelectedHistoryItem(null); }}>
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
    </>
  );
}
