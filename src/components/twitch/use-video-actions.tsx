'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
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
    sheet: sheetVideo && (
      <DownloadSheet video={sheetVideo} open onOpenChange={(open) => { if (!open) setSheetVideo(null); }} />
    ),
  };
}

export type VideoActions = ReturnType<typeof useVideoActions>;
