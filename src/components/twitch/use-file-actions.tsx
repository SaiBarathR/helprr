'use client';

import { useState } from 'react';
import { useMutation, useQueryClient, type InfiniteData, type QueryKey } from '@tanstack/react-query';
import { ExternalLink, HardDrive, Info, Moon, Pin, PinOff, Play, RotateCcw, Trash2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { useMe, hasCapability } from '@/components/permission-provider';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';
import type { SwipeAction } from '@/components/ui/swipe-row';
import { formatBytes } from '@/lib/format';
import type { TwitchFile } from './file-types';

type Confirming = { action: 'delete' | 'delete-original' | 'restore'; file: TwitchFile };

interface FilePage {
  files: TwitchFile[];
}

async function send(url: string, method: string, body?: unknown) {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  if (!res.ok) throw new Error(data?.error || 'Request failed');
}

export const CONFIRMATIONS = {
  delete: {
    title: 'Delete this video?',
    description: () => 'It is removed from the disk and from Jellyfin, with its chat, subtitles and any kept original. This cannot be undone.',
    confirmLabel: 'Delete',
  },
  'delete-original': {
    title: 'Delete the original?',
    description: (file: TwitchFile) => `Frees ${file.originalSizeBytes ? formatBytes(file.originalSizeBytes) : 'its space'}. The re-encoded video stays and still plays, but you can no longer restore the original.`,
    confirmLabel: 'Delete original',
  },
  restore: {
    title: 'Restore the original?',
    description: (file: TwitchFile) => `The original goes back in place and the re-encoded copy is deleted, so this uses ${file.originalSizeBytes ? `${formatBytes(file.originalSizeBytes - file.sizeBytes)} more` : 'more'} space. Jellyfin keeps your watched state.`,
    confirmLabel: 'Restore',
  },
} as const;

/** What can be done to a saved file. The routes check every one of these again. */
export function useFileActions() {
  const queryClient = useQueryClient();
  const canManage = hasCapability(useMe(), 'twitch.manage');
  const [confirming, setConfirming] = useState<Confirming | null>(null);
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['twitch'] });
  const fail = (error: Error) => toast.error(error.message);

  const keepForever = useMutation({
    mutationFn: ({ file, keep }: { file: TwitchFile; keep: boolean }) => send(`/api/twitch/files/${file.id}`, 'PATCH', { keepForever: keep }),
    // The switch answers the tap; a failure puts it back, as a video that only looks protected is not.
    onMutate: async ({ file, keep }) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['twitch', 'files'] }),
        queryClient.cancelQueries({ queryKey: ['twitch', 'file', file.id] }),
      ]);
      const before: Array<[QueryKey, unknown]> = [
        ...queryClient.getQueriesData({ queryKey: ['twitch', 'files'] }),
        ...queryClient.getQueriesData({ queryKey: ['twitch', 'file', file.id] }),
      ];
      queryClient.setQueriesData<InfiniteData<FilePage>>({ queryKey: ['twitch', 'files'] }, (data) => data && {
        ...data,
        pages: data.pages.map((page) => ({
          ...page,
          files: page.files.map((item) => (item.id === file.id ? { ...item, keepForever: keep } : item)),
        })),
      });
      queryClient.setQueryData<TwitchFile>(['twitch', 'file', file.id], (data) => data && { ...data, keepForever: keep });
      return before;
    },
    onSettled: refresh,
    onError: (error, _variables, before) => {
      for (const [key, data] of before ?? []) queryClient.setQueryData(key, data);
      fail(error);
    },
  });

  const reencode = useMutation({
    mutationFn: ({ file, when }: { file: TwitchFile; when: 'now' | 'tonight' }) => send(`/api/twitch/files/${file.id}/reencode`, 'POST', { when }),
    onSuccess: (_data, { when }) => {
      toast.success(when === 'now' ? 'Re-encoding starts within a minute' : 'Queued for tonight');
      refresh();
    },
    onError: fail,
  });

  const confirm = useMutation({
    mutationFn: ({ action, file }: Confirming) => {
      if (action === 'delete') return send(`/api/twitch/files/${file.id}`, 'DELETE');
      if (action === 'restore') return send(`/api/twitch/files/${file.id}/original/restore`, 'POST');
      return send(`/api/twitch/files/${file.id}/original`, 'DELETE');
    },
    onSuccess: (_data, { action }) => {
      toast.success(action === 'restore' ? 'Restoring the original' : action === 'delete' ? 'Deleting the video' : 'Deleting the original');
      setConfirming(null);
      refresh();
    },
    onError: fail,
  });

  const idle = (file: TwitchFile) => canManage && !file.activeJob;
  const canReencode = (file: TwitchFile) => canManage && !file.reencodedAt && file.videoCodec !== 'hevc'
    && (!file.activeJob || (file.activeJob.kind === 'REENCODE' && file.activeJob.state !== 'RUNNING'));

  const groupsFor = (file: TwitchFile): ContextActionGroup[] => [
    {
      id: 'open',
      actions: [
        { id: 'open', label: 'File details', icon: <HardDrive className="h-4 w-4" />, href: `/twitch/library/${file.id}` },
        { id: 'video', label: 'View video', icon: <Info className="h-4 w-4" />, href: `/twitch/vod/${file.videoId}` },
        ...(file.jellyfinItemId
          ? [{ id: 'play', label: 'Play in Helprr', icon: <Play className="h-4 w-4" />, href: `/jellyfin/library/item/${file.jellyfinItemId}` }]
          : []),
        { id: 'twitch', label: 'Open on Twitch', icon: <ExternalLink className="h-4 w-4" />, href: `https://www.twitch.tv/videos/${file.twitchVideoId}`, external: true },
      ],
    },
    {
      id: 'reencode',
      actions: canReencode(file)
        ? [
            { id: 'now', label: 'Re-encode now', icon: <Zap className="h-4 w-4" />, onSelect: () => reencode.mutate({ file, when: 'now' }) },
            { id: 'tonight', label: 'Re-encode tonight', icon: <Moon className="h-4 w-4" />, onSelect: () => reencode.mutate({ file, when: 'tonight' }) },
          ]
        : [],
    },
    {
      id: 'keep',
      actions: canManage
        ? [{
            id: 'keep',
            label: file.keepForever ? 'Stop keeping forever' : 'Keep forever',
            icon: file.keepForever ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
            onSelect: () => keepForever.mutate({ file, keep: !file.keepForever }),
          }]
        : [],
    },
    {
      id: 'original',
      actions: idle(file) && file.originalKept
        ? [
            { id: 'restore', label: 'Restore original', icon: <RotateCcw className="h-4 w-4" />, onSelect: () => setConfirming({ action: 'restore', file }) },
            { id: 'delete-original', label: 'Delete original', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setConfirming({ action: 'delete-original', file }) },
          ]
        : [],
    },
    {
      id: 'destructive',
      actions: idle(file)
        ? [{ id: 'delete', label: 'Delete video', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => setConfirming({ action: 'delete', file }) }]
        : [],
    },
  ];

  const swipeFor = (file: TwitchFile): { leftAction?: SwipeAction; rightAction?: SwipeAction } => ({
    leftAction: canManage
      ? {
          label: file.keepForever ? 'Unpin' : 'Keep',
          icon: file.keepForever ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />,
          className: 'bg-primary text-primary-foreground',
          onAction: () => keepForever.mutate({ file, keep: !file.keepForever }),
        }
      : undefined,
    rightAction: idle(file)
      ? {
          label: 'Delete',
          icon: <Trash2 className="h-4 w-4" />,
          className: 'bg-destructive text-destructive-foreground',
          onAction: () => setConfirming({ action: 'delete', file }),
        }
      : undefined,
  });

  const copy = confirming && CONFIRMATIONS[confirming.action];

  return {
    canManage,
    canReencode,
    idle,
    groupsFor,
    swipeFor,
    setKeepForever: (file: TwitchFile, keep: boolean) => keepForever.mutate({ file, keep }),
    reencode: (file: TwitchFile, when: 'now' | 'tonight') => reencode.mutate({ file, when }),
    reencoding: reencode.isPending,
    ask: (action: Confirming['action'], file: TwitchFile) => setConfirming({ action, file }),
    dialogs: (
      <ConfirmDialog
        open={confirming !== null}
        onOpenChange={(open) => { if (!open && !confirm.isPending) setConfirming(null); }}
        title={copy?.title ?? ''}
        description={confirming && copy ? copy.description(confirming.file) : undefined}
        confirmLabel={copy?.confirmLabel ?? 'Confirm'}
        destructive={confirming?.action !== 'restore'}
        busy={confirm.isPending}
        onConfirm={() => { if (confirming) confirm.mutate(confirming); }}
      />
    ),
  };
}

export type FileActions = ReturnType<typeof useFileActions>;
