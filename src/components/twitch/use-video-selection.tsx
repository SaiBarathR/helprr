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

  const selected = rows.filter((video) => selection.selectedKeys.has(video.id));
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
    /** Long press: start selecting with this video. */
    startWith: (video: TwitchVideo) => {
      selection.enter();
      selection.selectMany([video.id]);
    },
    selectionFor: (video: TwitchVideo): VideoSelection | undefined => (
      selection.selectionMode && !video.activeJob && (video.downloaded ? canManage : canDownload)
        ? { selected: selection.selectedKeys.has(video.id), onToggle: () => selection.toggle(video.id) }
        : undefined
    ),
    bar: selection.selectionMode && selection.count > 0 && (
      <FloatingActionBar>
        <span className="min-w-0 flex-1 text-sm text-muted-foreground">{selection.count} selected</span>
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
