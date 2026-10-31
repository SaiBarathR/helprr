'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { useMe, hasCapability } from '@/components/permission-provider';
import { Button } from '@/components/ui/button';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import type { TwitchVideo } from './types';
import type { VideoSelection } from './twitch-video-card';
import type { VideoActions } from './use-video-actions';

/** Selecting videos on the feed and on a streamer: downloads what is missing, deletes what is saved. */
export function useVideoSelection(rows: TwitchVideo[], actions: VideoActions) {
  const me = useMe();
  const canDownload = hasCapability(me, 'twitch.download');
  const canManage = hasCapability(me, 'twitch.manage');
  const queryClient = useQueryClient();
  const selection = useBulkSelection();

  const eligible = (video: TwitchVideo) => !video.activeJob
    && (video.downloaded ? canManage : canDownload && video.availability === 'PUBLISHED');
  // Checked again here: a selected video can start downloading before the bar is used.
  const selected = rows.filter((video) => selection.selectedKeys.has(video.id) && eligible(video));
  const toDelete = selected.filter((video) => video.fileId);
  const toDownload = selected.filter((video) => !video.fileId);

  const downloadSelected = useMutation({
    mutationFn: async () => {
      const results = await Promise.allSettled(toDownload.map(async ({ id: videoId }) => {
        const res = await fetch('/api/twitch/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ videoId, clientRequestId: crypto.randomUUID() }),
        });
        if (!res.ok) throw new Error('refused');
      }));
      return results.filter((result) => result.status === 'rejected').length;
    },
    onSuccess: (failed) => {
      const queued = toDownload.length - failed;
      if (failed > 0) toast.error(`${queued} queued, ${failed} could not be queued`);
      else toast.success(`${queued} queued`);
      selection.exit();
      void queryClient.invalidateQueries({ queryKey: ['twitch'] });
    },
  });

  return {
    canSelect: canDownload || canManage,
    active: selection.selectionMode,
    toggleMode: () => (selection.selectionMode ? selection.exit() : selection.enter()),
    /** The long-press action that starts selecting with this video, if it can be selected. */
    startWith: (video: TwitchVideo) => (eligible(video)
      ? () => {
          selection.enter();
          selection.selectMany([video.id]);
        }
      : undefined),
    selectionFor: (video: TwitchVideo): VideoSelection | undefined => (
      selection.selectionMode && eligible(video)
        ? { selected: selection.selectedKeys.has(video.id), onToggle: () => selection.toggle(video.id) }
        : undefined
    ),
    bar: selection.selectionMode && selected.length > 0 && (
      <FloatingActionBar>
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{selected.length} selected</span>
        {toDelete.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            onClick={() => {
              actions.deleteFiles(toDelete);
              selection.exit();
            }}
          >
            Delete {toDelete.length}
          </Button>
        )}
        {toDownload.length > 0 && (
          <Button size="sm" disabled={downloadSelected.isPending} onClick={() => downloadSelected.mutate()}>
            {downloadSelected.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : `Download ${toDownload.length}`}
          </Button>
        )}
      </FloatingActionBar>
    ),
  };
}
