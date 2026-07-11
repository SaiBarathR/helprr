'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, ensureArray, jsonFetcher, withInstanceQuery } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useParams, useSearchParams } from 'next/navigation';
import { format, formatDistanceToNow } from 'date-fns';
import { Loader2, Trash2 } from 'lucide-react';
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
import { PageSpinner } from '@/components/ui/page-spinner';
import { toast } from 'sonner';
import type { LidarrArtist, LidarrAlbum, LidarrTrackFile, HistoryItem } from '@/types';
import { formatBytes } from '@/lib/format';
import { useCan } from '@/components/permission-provider';

type DrawerRow = { label: string; value: string; breakValue?: boolean };

function basename(path: string): string {
  return path.split('/').pop() || path;
}

function historyEventLabel(eventType: string): string {
  switch (eventType) {
    case 'grabbed': return 'GRABBED';
    case 'downloadImported':
    case 'trackFileImported': return 'IMPORTED';
    case 'downloadFailed':
    case 'albumImportIncomplete': return 'FAILED';
    case 'trackFileDeleted': return 'DELETED';
    case 'trackFileRenamed': return 'RENAMED';
    case 'downloadIgnored': return 'IGNORED';
    default: return eventType.replace(/([A-Z])/g, ' $1').trim().toUpperCase();
  }
}

function historyEventVariant(eventType: string): 'default' | 'secondary' | 'destructive' | 'outline' {
  switch (eventType) {
    case 'grabbed': return 'secondary';
    case 'downloadImported':
    case 'trackFileImported': return 'default';
    case 'downloadFailed':
    case 'albumImportIncomplete':
    case 'trackFileDeleted': return 'destructive';
    default: return 'outline';
  }
}

function DetailRows({ rows }: { rows: DrawerRow[] }) {
  return (
    <div className="rounded-lg border overflow-hidden divide-y">
      {rows.map((row) => (
        <div key={`${row.label}-${row.value}`} className="flex justify-between items-start px-4 py-2.5">
          <span className="text-xs text-muted-foreground uppercase tracking-wide shrink-0">{row.label}</span>
          <span className={`text-sm text-right ml-4 ${row.breakValue ? 'break-all' : ''}`}>{row.value}</span>
        </div>
      ))}
    </div>
  );
}

export default function ArtistFilesPage() {
  const { id } = useParams<{ id: string }>();
  const artistId = Number(id);
  const instance = useSearchParams().get('instance') ?? undefined;
  const queryClient = useQueryClient();
  const [selectedFile, setSelectedFile] = useState<LidarrTrackFile | null>(null);

  const canDelete = useCan('music.delete');
  const enabled = Number.isFinite(artistId);
  const inst = instance ?? 'default';
  const trackfilesKey = ['lidarr', 'trackfile', inst, artistId] as const;

  const artistQuery = useQuery({
    queryKey: queryKeys.detail('lidarr', artistId, instance),
    queryFn: jsonFetcher<LidarrArtist>(`/api/lidarr/${artistId}`, instance),
    enabled,
  });
  const albumsQuery = useQuery({
    queryKey: ['lidarr', 'albums', inst, artistId],
    queryFn: jsonFetcher<LidarrAlbum[]>(`/api/lidarr/${artistId}/albums`, instance),
    enabled,
    select: ensureArray,
  });
  const filesQuery = useQuery({
    queryKey: trackfilesKey,
    queryFn: jsonFetcher<LidarrTrackFile[]>(`/api/lidarr/trackfile?artistId=${artistId}`, instance),
    enabled,
    select: ensureArray,
  });
  const historyQuery = useQuery({
    queryKey: ['lidarr', 'history', 'artist', inst, artistId],
    queryFn: jsonFetcher<HistoryItem[]>(`/api/lidarr/history/artist?artistId=${artistId}`, instance),
    enabled,
    select: ensureArray,
  });

  const artist = artistQuery.data ?? null;
  const albums = useMemo(() => albumsQuery.data ?? [], [albumsQuery.data]);
  const files = useMemo(() => filesQuery.data ?? [], [filesQuery.data]);
  const history = historyQuery.data ?? [];
  const loading =
    artistQuery.isLoading || albumsQuery.isLoading || filesQuery.isLoading || historyQuery.isLoading;

  const deleteMutation = useMutation({
    mutationFn: async (fileId: number) => {
      // Bulk endpoint with a single id — it validates the file belongs to this
      // artist and writes a file audit record (the old /trackfile/[id] did neither).
      const res = await fetch(withInstanceQuery('/api/lidarr/trackfile', instance), {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          artistId,
          trackFileIds: [fileId],
          mediaTitle: artist?.artistName,
        }),
      });
      // ApiError (not a plain Error) so a 401 carries its status to the global
      // MutationCache handler, which redirects to /login.
      if (!res.ok) throw new ApiError(res.status, 'Failed to delete file');
    },
    onSuccess: (_data, fileId) => {
      // Drop the deleted file from the cached list in place (matches the old
      // optimistic setFiles); no refetch needed.
      queryClient.setQueryData<LidarrTrackFile[]>(trackfilesKey, (prev) =>
        prev ? prev.filter((f) => f.id !== fileId) : prev
      );
      toast.success('File deleted');
      setSelectedFile(null);
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to delete file');
    },
  });
  const deleting = deleteMutation.isPending;

  const albumTitleById = useMemo(
    () => new Map(albums.map((a) => [a.id, a.title])),
    [albums]
  );

  const grouped = useMemo(() => {
    const groups = new Map<number, LidarrTrackFile[]>();
    for (const f of files) {
      const arr = groups.get(f.albumId) ?? [];
      arr.push(f);
      groups.set(f.albumId, arr);
    }
    return [...groups.entries()].map(([albumId, items]) => ({
      albumId,
      title: albumTitleById.get(albumId) ?? 'Unknown album',
      files: items.sort((a, b) => a.path.localeCompare(b.path)),
    }));
  }, [files, albumTitleById]);

  function handleDelete() {
    if (!selectedFile) return;
    deleteMutation.mutate(selectedFile.id);
  }

  if (loading && !artist) {
    return <><PageHeader title="Files & information" /><PageSpinner /></>;
  }

  if (!artist) {
    return (
      <div>
        <PageHeader title="Files & information" />
        <div className="text-center py-12 text-muted-foreground">Artist not found</div>
      </div>
    );
  }

  const fileRows = (file: LidarrTrackFile): DrawerRow[] => {
    const mi = file.mediaInfo;
    return [
      { label: 'Filename', value: basename(file.path), breakValue: true },
      ...(file.dateAdded ? [{ label: 'Added', value: format(new Date(file.dateAdded), "d MMM yyyy 'at' h:mm a") }] : []),
      { label: 'Size', value: formatBytes(file.size) },
      { label: 'Quality', value: file.quality?.quality?.name ?? 'Unknown' },
      ...(mi?.audioCodec ? [{ label: 'Codec', value: mi.audioCodec }] : []),
      ...(mi?.audioBits ? [{ label: 'Bit Depth', value: mi.audioBits }] : []),
      ...(mi?.audioSampleRate ? [{ label: 'Sample Rate', value: mi.audioSampleRate }] : []),
      ...(mi?.audioBitRate ? [{ label: 'Bitrate', value: mi.audioBitRate }] : []),
      ...(mi?.audioChannels !== undefined ? [{ label: 'Channels', value: String(mi.audioChannels) }] : []),
      ...(file.customFormatScore !== undefined ? [{ label: 'Score', value: file.customFormatScore >= 0 ? `+${file.customFormatScore}` : String(file.customFormatScore) }] : []),
      ...(file.qualityCutoffNotMet !== undefined ? [{ label: 'Quality Cutoff Not Met', value: file.qualityCutoffNotMet ? 'Yes' : 'No' }] : []),
      { label: 'Path', value: file.path, breakValue: true },
    ];
  };

  return (
    <div className="animate-content-in">
      <PageHeader title={artist.artistName} subtitle="Files & information" />

      <div className="space-y-6 pb-8">
        <section className="space-y-2">
          <h2 className="text-3xl font-bold leading-tight">Files</h2>
          {files.length === 0 ? (
            <div className="rounded-2xl border px-4 py-6 text-sm text-muted-foreground text-center">
              No files on disk
            </div>
          ) : (
            <div className="space-y-4">
              {grouped.map((group) => (
                <div key={group.albumId} className="space-y-1.5">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {group.title} · {group.files.length}
                  </h3>
                  <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/40">
                    {group.files.map((file) => (
                      <button
                        key={file.id}
                        onClick={() => setSelectedFile(file)}
                        className="w-full flex items-center gap-2 px-3 py-2.5 text-left hover:bg-muted/20 transition-colors"
                      >
                        <span className="flex-1 min-w-0 text-sm truncate">{basename(file.path)}</span>
                        {file.quality?.quality?.name && (
                          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 shrink-0">{file.quality.quality.name}</Badge>
                        )}
                        <span className="text-xs text-muted-foreground shrink-0">{formatBytes(file.size)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="space-y-2">
          <h2 className="text-3xl font-bold leading-tight">History</h2>
          {history.length === 0 ? (
            <div className="rounded-2xl border px-4 py-6 text-center text-sm text-muted-foreground">
              No history available
            </div>
          ) : (
            <div className="space-y-2">
              {history.map((item, index) => (
                <div
                  key={`${item.id}-${item.date}-${index}`}
                  className="rounded-2xl border bg-card px-4 py-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <Badge variant={historyEventVariant(item.eventType)} className="text-[10px]">
                      {historyEventLabel(item.eventType)}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                    </span>
                  </div>
                  <p className="text-sm mt-2 break-all leading-tight">{item.sourceTitle}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {[item.album?.title, item.quality?.quality?.name].filter(Boolean).join(' · ')}
                  </p>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>

      <Drawer open={!!selectedFile} onOpenChange={(open) => { if (!open) setSelectedFile(null); }}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>File information</DrawerTitle>
            <DrawerDescription className="break-all">
              {selectedFile ? basename(selectedFile.path) : ''}
            </DrawerDescription>
          </DrawerHeader>
          {selectedFile && (
            <div className="px-4 pb-4 space-y-4 overflow-y-auto flex-1 min-h-0">
              <DetailRows rows={fileRows(selectedFile)} />
              {canDelete && (
                <Button variant="destructive" className="w-full" onClick={handleDelete} disabled={deleting}>
                  {deleting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Trash2 className="h-4 w-4 mr-2" />}
                  Delete File
                </Button>
              )}
              <DrawerClose asChild>
                <Button variant="ghost" className="w-full">Close</Button>
              </DrawerClose>
            </div>
          )}
        </DrawerContent>
      </Drawer>
    </div>
  );
}
