'use client';

import { useState } from 'react';
import { useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { CheckCircle2, Download, ExternalLink, Eye, EyeOff, Info, Play, Trash2, User, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useAppRouter as useRouter } from '@/components/layout/navigation-provider';
import { useMe, hasCapability } from '@/components/permission-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';
import type { SwipeAction } from '@/components/ui/swipe-row';
import { DownloadSheet } from './download-sheet';
import type { TwitchVideo, TwitchVideoPage } from './types';

async function post(url: string, body: unknown) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
}

// Feed pages are either the infinite list or a single shelf.
function withoutVideo(videoId: string) {
  const drop = (page: TwitchVideoPage) => ({ ...page, videos: page.videos.filter((video) => video.id !== videoId) });
  return (data: InfiniteData<TwitchVideoPage> | TwitchVideoPage | undefined) => {
    if (!data) return data;
    return 'pages' in data ? { ...data, pages: data.pages.map(drop) } : drop(data);
  };
}

/** What every video can do, on any surface, and the sheet and dialog they share. */
export function useVideoActions() {
  const queryClient = useQueryClient();
  const router = useRouter();
  const me = useMe();
  const canDownload = hasCapability(me, 'twitch.download');
  const canManage = hasCapability(me, 'twitch.manage');
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
    onSettled: refresh,
    onError: fail,
  });

  // There is no list of hidden videos, so a stray swipe has to be recoverable here.
  const hide = (video: TwitchVideo) => {
    queryClient.setQueriesData({ queryKey: ['twitch', 'feed'] }, withoutVideo(video.id));
    setState.mutate({ video, state: { hidden: true } }, {
      onSuccess: () => toast('Hidden from your feed', {
        action: { label: 'Undo', onClick: () => setState.mutate({ video, state: { hidden: false } }) },
      }),
    });
  };

  const isDownloadable = (video: TwitchVideo) =>
    canDownload && !video.downloaded && !video.activeJob && video.availability === 'PUBLISHED';
  const isDeletable = (video: TwitchVideo) => canManage && Boolean(video.fileId) && !video.activeJob;

  const groupsFor = (video: TwitchVideo, onSelect?: () => void): ContextActionGroup[] => [
    {
      id: 'open',
      actions: [
        { id: 'open', label: 'View video', icon: <Info className="h-4 w-4" />, href: `/twitch/vod/${video.id}` },
        ...(video.jellyfinItemId
          ? [{ id: 'play', label: 'Play in Helprr', icon: <Play className="h-4 w-4" />, href: `/jellyfin/library/item/${video.jellyfinItemId}` }]
          : []),
        { id: 'streamer', label: video.streamer.displayName, icon: <User className="h-4 w-4" />, href: `/twitch/streamers/${video.streamer.id}` },
      ],
    },
    {
      id: 'download',
      actions: isDownloadable(video)
        ? [
            { id: 'download', label: 'Download…', icon: <Download className="h-4 w-4" />, onSelect: () => setSheetVideo(video) },
            { id: 'quick', label: 'Quick download', icon: <Zap className="h-4 w-4" />, onSelect: () => quick.mutate(video) },
          ]
        : [],
    },
    {
      id: 'state',
      actions: [
        ...(onSelect ? [{ id: 'select', label: 'Select', icon: <CheckCircle2 className="h-4 w-4" />, onSelect }] : []),
        ...(video.seen ? [] : [{
          id: 'seen',
          label: 'Mark seen',
          icon: <Eye className="h-4 w-4" />,
          onSelect: () => setState.mutate({ video, state: { seen: true } }),
        }]),
        { id: 'hide', label: 'Hide', icon: <EyeOff className="h-4 w-4" />, onSelect: () => hide(video) },
        {
          id: 'twitch',
          label: 'Open on Twitch',
          icon: <ExternalLink className="h-4 w-4" />,
          href: `https://www.twitch.tv/videos/${video.twitchVideoId}`,
          external: true,
        },
      ],
    },
    {
      id: 'destructive',
      actions: isDeletable(video)
        ? [{ id: 'delete', label: 'Delete the file', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setDeleting([video]) }]
        : [],
    },
  ];

  const swipeFor = (video: TwitchVideo): { leftAction?: SwipeAction; rightAction: SwipeAction } => ({
    leftAction: video.jellyfinItemId
      ? {
          label: 'Play',
          icon: <Play className="h-4 w-4" />,
          className: 'bg-primary text-primary-foreground',
          onAction: () => router.push(`/jellyfin/library/item/${video.jellyfinItemId}`),
        }
      : isDownloadable(video)
        ? {
            label: 'Download',
            icon: <Download className="h-4 w-4" />,
            className: 'bg-primary text-primary-foreground',
            onAction: () => quick.mutate(video),
          }
        : undefined,
    rightAction: isDeletable(video)
      ? {
          label: 'Delete',
          icon: <Trash2 className="h-4 w-4" />,
          className: 'bg-destructive text-destructive-foreground',
          onAction: () => setDeleting([video]),
        }
      : {
          label: 'Hide',
          icon: <EyeOff className="h-4 w-4" />,
          className: 'bg-muted text-foreground',
          onAction: () => hide(video),
        },
  });

  return {
    groupsFor,
    swipeFor,
    openSheet: setSheetVideo,
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
