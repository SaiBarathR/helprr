'use client';

import { useEffect, useMemo, useState } from 'react';
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

// Append the viewing instance to a Lidarr API path so the page reads/mutates the
// correct instance. No-op (single-instance-identical) when instance is undefined.
function withInstanceQuery(url: string, instance?: string): string {
  if (!instance) return url;
  return `${url}${url.includes('?') ? '&' : '?'}instanceId=${instance}`;
}
function lidarrFetch(instance: string | undefined, path: string, init?: RequestInit): Promise<Response> {
  return fetch(withInstanceQuery(path, instance), init);
}

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
  const [artist, setArtist] = useState<LidarrArtist | null>(null);
  const [albums, setAlbums] = useState<LidarrAlbum[]>([]);
  const [files, setFiles] = useState<LidarrTrackFile[]>([]);
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedFile, setSelectedFile] = useState<LidarrTrackFile | null>(null);
  const [deleting, setDeleting] = useState(false);

  const canDelete = useCan('music.delete');

  useEffect(() => {
    let cancelled = false;
    void Promise.allSettled([
      lidarrFetch(instance, `/api/lidarr/${artistId}`).then((r) => (r.ok ? r.json() : null)),
      lidarrFetch(instance, `/api/lidarr/${artistId}/albums`).then((r) => (r.ok ? r.json() : [])),
      lidarrFetch(instance, `/api/lidarr/trackfile?artistId=${artistId}`).then((r) => (r.ok ? r.json() : [])),
      lidarrFetch(instance, `/api/lidarr/history/artist?artistId=${artistId}`).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([a, alb, f, h]) => {
        if (cancelled) return;
        if (a.status === 'fulfilled') setArtist(a.value as LidarrArtist | null);
        if (alb.status === 'fulfilled') setAlbums(Array.isArray(alb.value) ? alb.value : []);
        if (f.status === 'fulfilled') setFiles(Array.isArray(f.value) ? f.value : []);
        if (h.status === 'fulfilled') setHistory(Array.isArray(h.value) ? h.value : []);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [artistId, instance]);

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

  async function handleDelete() {
    if (!selectedFile) return;
    setDeleting(true);
    try {
      const res = await lidarrFetch(instance, `/api/lidarr/trackfile/${selectedFile.id}`, { method: 'DELETE' });
      if (res.ok) {
        setFiles((prev) => prev.filter((f) => f.id !== selectedFile.id));
        toast.success('File deleted');
        setSelectedFile(null);
      } else {
        toast.error('Failed to delete file');
      }
    } catch { toast.error('Failed to delete file'); }
    finally { setDeleting(false); }
  }

  if (loading) {
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
