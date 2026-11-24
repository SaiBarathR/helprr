'use client';

import { useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { format } from 'date-fns';
import { Copy, FileStack, Info } from 'lucide-react';
import { PageHeader } from '@/components/layout/page-header';
import { NotFoundState } from '@/components/ui/not-found-state';
import { Button } from '@/components/ui/button';
import { useCan } from '@/components/permission-provider';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { PageSpinner } from '@/components/ui/page-spinner';
import { ArrHistoryList } from '@/components/media/arr-history-list';
import { CustomFormatChips } from '@/components/media/custom-format-chips';
import { AlternateTitlesRow } from '@/components/media/alternate-titles';
import { CollapsibleRow } from '@/components/media/collapsible-row';
import { TitleBlocklist } from '@/components/media/title-blocklist';
import { useArrInstanceId } from '@/lib/hooks/use-arr-instance-id';
import type { ExtraFileResource, HistoryItem, MovieFileResource, RadarrMovie } from '@/types';
import { useQuery } from '@tanstack/react-query';
import { queryKeys } from '@/lib/query-keys';
import { ApiError, arrMutationFetch } from '@/lib/query-fetch';
import { QuickContextMenu, type ContextAction } from '@/components/ui/quick-context-menu';
import { toast } from 'sonner';

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

const EXTRA_TYPE_LABEL: Record<ExtraFileResource['type'], string> = {
  subtitle: 'Subtitle',
  metadata: 'Metadata',
  other: 'Other',
};
const EXTRA_TYPE_ORDER: ExtraFileResource['type'][] = ['subtitle', 'metadata', 'other'];

/** The subtitles, .nfo and images beside the movie's file; the summary counts each kind. */
function ExtraFilesRow({ files }: { files: ExtraFileResource[] }) {
  const sorted = [...files].sort((a, b) =>
    EXTRA_TYPE_ORDER.indexOf(a.type) - EXTRA_TYPE_ORDER.indexOf(b.type)
    || a.relativePath.localeCompare(b.relativePath));
  const summary = EXTRA_TYPE_ORDER
    .map((type) => [type, files.filter((file) => file.type === type).length] as const)
    .filter(([, count]) => count > 0)
    .map(([type, count]) => `${count} ${EXTRA_TYPE_LABEL[type].toLowerCase()}`)
    .join(', ');
  return (
    <CollapsibleRow label="Extra files" summary={summary} className="rounded-2xl border bg-card px-4">
      <ul className="divide-y divide-border/40">
        {sorted.map((file) => (
          <li key={file.id} className="py-2 first:pt-0 last:pb-0">
            <p className="text-sm leading-tight break-all">{file.relativePath}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {[EXTRA_TYPE_LABEL[file.type], file.title, file.languageTags?.join(', ')].filter(Boolean).join(' \u00b7 ')}
            </p>
          </li>
        ))}
      </ul>
    </CollapsibleRow>
  );
}

function DetailRows({ rows }: { rows: DrawerRow[] }) {
  return (
    <div className="rounded-lg border overflow-hidden divide-y">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="flex justify-between items-start gap-4 px-4 py-2.5">
          <span className="shrink-0 text-xs text-muted-foreground uppercase tracking-wide">{row.label}</span>
          <span className={`min-w-0 text-sm text-right ${row.breakValue ? 'break-all' : '[overflow-wrap:anywhere]'}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function MovieFilesPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const movieId = Number(id);
  const instance = useSearchParams().get('instance') ?? undefined;
  const [fileDrawerOpen, setFileDrawerOpen] = useState(false);
  const canManageFiles = useCan('movies.manageFiles');
  // Mark as failed and the blocklist name the instance; a page opened without
  // ?instance= is on the default one.
  const instanceId = useArrInstanceId('RADARR', instance);

  async function copyText(value: string, label: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success(label);
    } catch {
      toast.error('Failed to copy');
    }
  }

  // Shares the detail page's cache key so navigating back to the movie is warm.
  const movieQuery = useQuery({
    queryKey: queryKeys.detail('radarr', movieId, instance),
    queryFn: async ({ signal }): Promise<RadarrMovie | null> => {
      const r = await arrMutationFetch(instance, `/api/radarr/${movieId}`, { signal });
      if (!r.ok) {
        // Only a genuine 404 means "not found"; surface auth/server errors instead
        // of rendering them as a missing movie.
        if (r.status === 404) return null;
        throw new ApiError(r.status, `GET /api/radarr/${movieId} → ${r.status}`);
      }
      return (await r.json()) as RadarrMovie;
    },
    enabled: Number.isFinite(movieId),
  });
  const movie = movieQuery.data ?? null;
  const loading = movieQuery.isLoading;

  const historyQuery = useQuery({
    queryKey: ['radarr', 'history', 'movie', instance ?? 'default', movieId],
    queryFn: async ({ signal }): Promise<HistoryItem[]> => {
      const r = await arrMutationFetch(instance, `/api/radarr/history/movie?movieId=${movieId}`, { signal });
      return r.ok ? ((await r.json()) as HistoryItem[]) : [];
    },
    enabled: Number.isFinite(movieId),
    select: (d) => (Array.isArray(d) ? d : []),
  });
  const history = historyQuery.data ?? [];
  const historyLoading = historyQuery.isLoading;

  // Radarr's movie resource leaves the custom formats and their score off its
  // embedded file; only the moviefile resource has them.
  const fileResourceQuery = useQuery({
    queryKey: ['radarr', 'moviefile', instance ?? 'default', movieId],
    queryFn: async ({ signal }): Promise<MovieFileResource[]> => {
      const r = await arrMutationFetch(instance, `/api/radarr/moviefile?movieId=${movieId}`, { signal });
      return r.ok ? ((await r.json()) as MovieFileResource[]) : [];
    },
    enabled: Number.isFinite(movieId) && movieQuery.data?.hasFile === true,
    select: (d) => (Array.isArray(d) ? d : []),
  });

  const extraFilesQuery = useQuery({
    queryKey: ['radarr', 'extrafile', instance ?? 'default', movieId],
    queryFn: async ({ signal }): Promise<ExtraFileResource[]> => {
      const r = await arrMutationFetch(instance, `/api/radarr/extrafile?movieId=${movieId}`, { signal });
      return r.ok ? ((await r.json()) as ExtraFileResource[]) : [];
    },
    enabled: Number.isFinite(movieId) && movieQuery.data?.hasFile === true,
    select: (d) => (Array.isArray(d) ? d : []),
  });
  const extraFiles = extraFilesQuery.data ?? [];

  if (loading && !movie) {
    return <><PageHeader title="Files & information" /><PageSpinner /></>;
  }

  if (!movie) {
    return (
      <div>
        <PageHeader title="Files & information" />
        <NotFoundState message="Movie not found" />
      </div>
    );
  }

  const movieFile = movie.movieFile;
  const mediaInfo = movieFile?.mediaInfo;
  const qualityName = movieFile?.quality?.quality?.name ?? 'Unknown';
  const fileResource = movieFile
    ? (fileResourceQuery.data ?? []).find((file) => file.id === movieFile.id)
    : undefined;
  const score = fileResource?.customFormatScore;
  const customFormatNames = (fileResource?.customFormats ?? []).map((cf) => cf.name).filter(Boolean);
  const fileLanguages = movieFile?.languages?.length
    ? movieFile.languages.map((entry) => entry.name).join(', ')
    : movieFile?.language?.name ?? '';
  const audioLanguages = mediaInfo?.audioLanguages || fileLanguages;
  const subtitles = mediaInfo?.subtitles?.trim() ? mediaInfo.subtitles : 'None';
  const addedLabel = safeFormatDate(movieFile?.dateAdded, "d MMMM yyyy 'at' h:mm a")
    ?? safeFormatDate(movie.added, 'd MMMM yyyy');
  const manageHref = `/movies/${movieId}/manage?title=${encodeURIComponent(movie.title)}${instance ? `&instance=${instance}` : ''}`;
  const fileActions: ContextAction[] = movieFile ? [
    {
      id: 'information',
      label: 'View information',
      icon: <Info className="h-4 w-4" />,
      onSelect: () => setFileDrawerOpen(true),
    },
    ...(canManageFiles ? [{
      id: 'manage',
      label: 'Manage file',
      icon: <FileStack className="h-4 w-4" />,
      onSelect: () => router.push(manageHref),
    }] : []),
    {
      id: 'copy-path',
      label: 'Copy path',
      icon: <Copy className="h-4 w-4" />,
      onSelect: () => void copyText(movieFile.path || movieFile.relativePath, 'Path copied'),
    },
  ] : [];

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
    ...(score !== undefined ? [{ label: 'Score', value: score >= 0 ? `+${score}` : String(score) }] : []),
    ...(customFormatNames.length > 0 ? [{ label: 'Custom Formats', value: customFormatNames.join(', ') }] : []),
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
    <div className="animate-content-in">
      <PageHeader title={movie.title} />

      <div className="space-y-6 pb-8">
        <section className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-lg font-bold leading-tight">Files</h2>
            {canManageFiles && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => router.push(manageHref)}
              >
                <FileStack className="mr-2 h-4 w-4" />
                Manage
              </Button>
            )}
          </div>
          {movie.hasFile && movieFile ? (
            <QuickContextMenu
              label={`Actions for ${movieFile.relativePath}`}
              actions={fileActions}
            >
              <button
                onClick={() => setFileDrawerOpen(true)}
                className="w-full rounded-2xl border bg-card p-4 text-left active:bg-muted/50 transition-colors"
              >
                <p className="text-xl font-semibold break-words leading-tight">{movieFile.relativePath}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  {[qualityName, fileLanguages, formatBytes(movieFile.size)].filter(Boolean).join(' \u00b7 ')}
                </p>
                <CustomFormatChips
                  score={fileResource?.customFormatScore}
                  formats={fileResource?.customFormats}
                  className="mt-2"
                />
              </button>
            </QuickContextMenu>
          ) : (
            <div className="rounded-2xl border px-4 py-6 text-sm text-muted-foreground text-center">
              No file on disk
            </div>
          )}
          {movie.hasFile && extraFiles.length > 0 && <ExtraFilesRow files={extraFiles} />}
        </section>

        {(movie.alternateTitles?.length ?? 0) > 0 && (
          <section className="space-y-2">
            <h2 className="text-lg font-bold leading-tight">Information</h2>
            <AlternateTitlesRow titles={movie.alternateTitles} className="rounded-2xl border bg-card px-4" />
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-lg font-bold leading-tight">History</h2>
          <ArrHistoryList items={history} loading={historyLoading} source="radarr" instanceId={instanceId} />
        </section>

        <TitleBlocklist source="radarr" mediaId={movieId} instanceId={instanceId} />
      </div>

      <Drawer open={fileDrawerOpen} onOpenChange={setFileDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Information</DrawerTitle>
            <DrawerDescription className="break-all">
              {movieFile?.relativePath || movie.title}
            </DrawerDescription>
          </DrawerHeader>
          <div className="px-4 pb-4 space-y-4 overflow-y-auto flex-1 min-h-0">
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

    </div>
  );
}
