'use client';

import { use, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'next/navigation';
import { AlertTriangle, Download, Play, Trash2, Tv } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useMe, hasCapability } from '@/components/permission-provider';
import { DownloadSheet } from '@/components/twitch/download-sheet';
import { FadeInImage } from '@/components/media/fade-in-image';
import { daysUntil, formatDuration, VIDEO_TYPE_LABELS, type TwitchVideo } from '@/components/twitch/types';
import { toCachedImageSrc } from '@/lib/image';

function mutedTotal(video: TwitchVideo): number {
  return (video.mutedSegments ?? []).reduce((total, segment) => total + segment.duration, 0);
}

export default function TwitchVodPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  // A push lands here with ?download=1, so the sheet is already open.
  const [sheetOpen, setSheetOpen] = useState(useSearchParams().get('download') === '1');

  const query = useQuery({
    queryKey: ['twitch', 'video', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/videos/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load video');
      return (await res.json()) as TwitchVideo & { autoDownload: { enabled: boolean; reason: string; trace: Record<string, string> } };
    },
  });
  const video = query.data;

  const canManage = hasCapability(useMe(), 'twitch.manage');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const removeFile = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/twitch/files/${video?.fileId}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not delete the file');
    },
    onSuccess: () => {
      toast.success('Queued for deletion');
      setConfirmDelete(false);
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
    },
    onError: (error) => toast.error(error.message),
  });

  const unseen = video && !video.seen;
  useEffect(() => {
    if (!unseen) return;
    void fetch(`/api/twitch/videos/${id}/state`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ seen: true }),
    }).then(() => queryClient.invalidateQueries({ queryKey: ['twitch', 'feed'] }));
  }, [id, unseen, queryClient]);

  if (query.isError) {
    return <p className="py-16 text-center text-sm text-muted-foreground">This video could not be loaded.</p>;
  }
  if (!video) return null;

  const thumbnail = toCachedImageSrc(video.thumbnailUrl, undefined, { width: 1200 });
  const expiresIn = daysUntil(video.estimatedExpiresAt);
  const muted = mutedTotal(video);

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title={video.streamer.displayName} backHref="/twitch" />
      <div className="relative aspect-video max-h-[50vh] w-full overflow-hidden bg-muted">
        {thumbnail ? (
          <FadeInImage src={thumbnail} alt="" fill sizes="100vw" className="object-cover" unoptimized />
        ) : (
          <div className="flex h-full items-center justify-center text-muted-foreground"><Tv className="h-10 w-10" /></div>
        )}
      </div>
      <div className="space-y-3 px-4 pt-3">
        <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground">
          {video.availability === 'RECORDING' ? 'Recording' : VIDEO_TYPE_LABELS[video.type]} · {formatDuration(video.durationSeconds)}
        </p>
        <h1 className="text-lg font-semibold leading-snug">{video.title}</h1>
        <p className="text-sm text-muted-foreground">
          <Link href={`/twitch/streamers/${video.streamer.id}`} className="underline-offset-2 hover:underline">{video.streamer.displayName}</Link>
          {' · '}{format(new Date(video.twitchCreatedAt), 'PP')}
        </p>
        {video.jellyfinItemId ? (
          <Button asChild className="h-11 w-full">
            <Link href={`/jellyfin/library/item/${video.jellyfinItemId}`}><Play className="mr-2 h-4 w-4" />Play in Helprr</Link>
          </Button>
        ) : video.activeJob ? (
          <Button asChild variant="outline" className="h-11 w-full">
            <Link href="/twitch/queue">In the queue</Link>
          </Button>
        ) : !video.downloaded && video.availability === 'PUBLISHED' && (
          <Button className="h-11 w-full" onClick={() => setSheetOpen(true)}>
            <Download className="mr-2 h-4 w-4" />Download
          </Button>
        )}
        {expiresIn !== null && expiresIn >= 0 && (
          <p className="text-sm text-muted-foreground">Estimated to expire in {expiresIn} {expiresIn === 1 ? 'day' : 'days'}.</p>
        )}
        {muted > 0 && (
          <p className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-sm text-amber-300">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>
              Twitch muted {formatDuration(muted)} of this video&apos;s audio. It cannot be recovered.
              <span className="mt-1 block font-mono text-xs">
                {(video.mutedSegments ?? []).map((segment) => `${formatDuration(segment.offset)}–${formatDuration(segment.offset + segment.duration)}`).join(', ')}
              </span>
            </span>
          </p>
        )}
        {(video.chapters?.length ?? 0) > 0 && (
          <section aria-label="Chapters">
            <h2 className="mb-1 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Chapters</h2>
            <ul className="space-y-0.5 text-sm">
              {video.chapters!.map((chapter) => (
                <li key={`${chapter.start}-${chapter.title}`} className="flex gap-3">
                  <span className="font-mono text-xs leading-5 text-muted-foreground">{formatDuration(chapter.start)}</span>
                  <span className="min-w-0 truncate">{chapter.title}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
        <details className="text-xs text-muted-foreground">
          <summary className="min-h-9 cursor-pointer py-2">
            {video.autoDownload.enabled ? 'Auto-download would save this' : 'Auto-download would skip this'}: {
              video.autoDownload.reason === 'master-switch' ? 'auto-download is off' : video.autoDownload.reason
            }.
          </summary>
          <dl className="grid grid-cols-2 gap-x-3 gap-y-0.5">
            {Object.entries(video.autoDownload.trace).map(([field, layer]) => (
              <div key={field} className="flex justify-between gap-2"><dt>{field}</dt><dd className="font-mono">{layer}</dd></div>
            ))}
          </dl>
        </details>
        {canManage && video.fileId && !video.activeJob && (
          <Button variant="outline" className="h-11 w-full" onClick={() => setConfirmDelete(true)}>
            <Trash2 className="mr-2 h-4 w-4" />Delete the file
          </Button>
        )}
        {video.description && <p className="whitespace-pre-wrap text-sm text-muted-foreground">{video.description}</p>}
      </div>
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this file?"
        description="It is removed from the disk and from Jellyfin, with its chat and subtitles. This cannot be undone."
        confirmLabel="Delete"
        destructive
        busy={removeFile.isPending}
        onConfirm={() => removeFile.mutate()}
      />
      {!video.downloaded && !video.activeJob && <DownloadSheet video={video} open={sheetOpen} onOpenChange={setSheetOpen} />}
    </div>
  );
}
