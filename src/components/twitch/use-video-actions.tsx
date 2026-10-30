'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { DownloadSheet } from './download-sheet';
import type { TwitchVideo } from './types';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
}

/** What every card can do, and the one sheet they share. */
export function useVideoActions() {
  const queryClient = useQueryClient();
  const [sheetVideo, setSheetVideo] = useState<TwitchVideo | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['twitch'] });
  const fail = (error: Error) => toast.error(error.message);

  const [deleting, setDeleting] = useState<TwitchVideo[]>([]);
  const removeFiles = useMutation({
    mutationFn: async (videos: TwitchVideo[]) => {
      const results = await Promise.allSettled(videos.map(async ({ fileId }) => {
        const res = await fetch(`/api/twitch/files/${fileId}`, { method: 'DELETE' });
        if (!res.ok) throw new Error('refused');
      }));
      return results.filter((result) => result.status === 'rejected').length;
    },
    onSuccess: (failed, videos) => {
      if (failed > 0) toast.error(`${videos.length - failed} deleted, ${failed} could not be deleted`);
      else toast.success(videos.length === 1 ? 'Deleting the file' : `Deleting ${videos.length} files`);
      setDeleting([]);
      refresh();
    },
    onError: fail,
  });

  const quick = useMutation({
    // No options: the rules for this video decide them.
    mutationFn: (video: TwitchVideo) => post('/api/twitch/jobs', { videoId: video.id, clientRequestId: crypto.randomUUID() }),
    onSuccess: () => {
      toast.success('Download queued');
      refresh();
    },
    onError: fail,
  });
  const setState = useMutation({
    mutationFn: ({ video, state }: { video: TwitchVideo; state: { seen?: boolean; hidden?: boolean } }) =>
      post(`/api/twitch/videos/${video.id}/state`, state),
    onSuccess: refresh,
    onError: fail,
  });

  return {
    openSheet: setSheetVideo,
    quickDownload: (video: TwitchVideo) => quick.mutate(video),
    markSeen: (video: TwitchVideo) => setState.mutate({ video, state: { seen: true } }),
    hide: (video: TwitchVideo) => setState.mutate({ video, state: { hidden: true } }),
    /** Asks first: this cannot be undone. */
    deleteFiles: (videos: TwitchVideo[]) => setDeleting(videos.filter((video) => video.fileId)),
    sheet: (
      <>
        {sheetVideo && <DownloadSheet video={sheetVideo} open onOpenChange={(open) => { if (!open) setSheetVideo(null); }} />}
        <ConfirmDialog
          open={deleting.length > 0}
          onOpenChange={(open) => { if (!open && !removeFiles.isPending) setDeleting([]); }}
          title={deleting.length === 1 ? 'Delete this file?' : `Delete ${deleting.length} files?`}
          description="They are removed from the disk and from Jellyfin, with their chat and subtitles. This cannot be undone."
          confirmLabel="Delete"
          destructive
          busy={removeFiles.isPending}
          onConfirm={() => removeFiles.mutate(deleting)}
        />
      </>
    ),
  };
}

export type VideoActions = ReturnType<typeof useVideoActions>;
