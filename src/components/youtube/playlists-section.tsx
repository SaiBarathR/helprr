'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ChevronRight, Info, ListVideo, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { FadeInImage } from '@/components/media/fade-in-image';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';
import { SwipeRow } from '@/components/ui/swipe-row';
import { toCachedImageSrc } from '@/lib/image';

interface PlaylistSubscription {
  id: string;
  notifyNewVideos: boolean;
  playlist: { id: string; title: string; ownerName: string | null; thumbnailUrl: string | null; itemCount: number };
}

const QUERY_KEY = ['youtube', 'playlists'];

function PlaylistRow({ subscription, onToggleNotify, onUnfollow }: {
  subscription: PlaylistSubscription;
  onToggleNotify: () => void;
  onUnfollow: () => void;
}) {
  const { notifyNewVideos, playlist } = subscription;
  const thumbnail = toCachedImageSrc(playlist.thumbnailUrl, undefined, { width: 160 });
  const NotifyIcon = notifyNewVideos ? BellOff : Bell;
  const notifyLabel = notifyNewVideos ? 'Turn off notifications' : 'Turn on notifications';
  const href = `/youtube/playlists/${playlist.id}`;
  const groups: ContextActionGroup[] = [
    { id: 'open', actions: [{ id: 'open', label: 'View playlist', icon: <Info className="h-4 w-4" />, href }] },
    { id: 'notify', actions: [{ id: 'notify', label: notifyLabel, icon: <NotifyIcon className="h-4 w-4" />, onSelect: onToggleNotify }] },
    { id: 'destructive', actions: [{ id: 'unfollow', label: 'Unfollow', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: onUnfollow }] },
  ];

  return (
    <SwipeRow
      contentClassName="bg-card"
      leftAction={{
        label: notifyNewVideos ? 'Mute' : 'Notify',
        icon: <NotifyIcon className="h-4 w-4" />,
        className: 'bg-primary text-primary-foreground',
        onAction: onToggleNotify,
      }}
      rightAction={{
        label: 'Remove',
        icon: <Trash2 className="h-4 w-4" />,
        className: 'bg-destructive text-destructive-foreground',
        onAction: onUnfollow,
      }}
    >
      <QuickContextMenu label={`${playlist.title} actions`} groups={groups}>
        <div className="relative flex items-center gap-3 px-3 py-2.5">
          <span className="relative block aspect-video h-10 shrink-0 overflow-hidden rounded bg-muted">
            {thumbnail
              ? <FadeInImage src={thumbnail} alt="" fill sizes="72px" className="object-cover" unoptimized />
              : <ListVideo className="absolute inset-0 m-auto h-4 w-4 text-muted-foreground" />}
          </span>
          <div className="min-w-0 flex-1">
            <Link href={href} data-context-menu-row className="block truncate text-sm font-medium after:absolute after:inset-0">
              {playlist.title}
            </Link>
            <p className="truncate text-[11px] text-muted-foreground">
              {[playlist.ownerName, `${playlist.itemCount} ${playlist.itemCount === 1 ? 'video' : 'videos'}`].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button
            type="button"
            aria-label={`${notifyLabel} for ${playlist.title}`}
            aria-pressed={notifyNewVideos}
            onClick={onToggleNotify}
            className="relative flex h-11 w-9 shrink-0 items-center justify-center"
          >
            {notifyNewVideos ? <Bell className="h-4 w-4 text-primary" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
          </button>
          <ChevronRight className="-ml-1 h-4 w-4 shrink-0 text-muted-foreground" />
        </div>
      </QuickContextMenu>
    </SwipeRow>
  );
}

export function PlaylistsSection() {
  const queryClient = useQueryClient();
  const [leaving, setLeaving] = useState<PlaylistSubscription | null>(null);
  const list = useQuery({
    queryKey: QUERY_KEY,
    queryFn: async ({ signal }) => {
      const res = await fetch('/api/youtube/playlists', { signal });
      if (!res.ok) throw new Error('Failed to load');
      return (await res.json()) as { subscriptions: PlaylistSubscription[] };
    },
  });
  const subscriptions = list.data?.subscriptions ?? [];

  const toggleNotify = useMutation({
    mutationFn: async ({ id, notifyNewVideos }: { id: string; notifyNewVideos: boolean }) => {
      const res = await fetch(`/api/youtube/playlist-subscriptions/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNewVideos }),
      });
      if (!res.ok) throw new Error('Could not change notifications');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: QUERY_KEY }),
    onError: (error) => toast.error(error.message),
  });
  const unfollow = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/youtube/playlist-subscriptions/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not unfollow');
    },
    onSuccess: () => {
      setLeaving(null);
      void queryClient.invalidateQueries({ queryKey: ['youtube'] });
    },
    onError: (error) => toast.error(error.message),
  });

  if (subscriptions.length === 0) return null;
  return (
    <section aria-label="Playlists">
      <p className="px-1 pb-2 text-xs text-muted-foreground">{subscriptions.length} {subscriptions.length === 1 ? 'playlist' : 'playlists'}</p>
      <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
        {subscriptions.map((subscription) => (
          <PlaylistRow
            key={subscription.id}
            subscription={subscription}
            onToggleNotify={() => toggleNotify.mutate({ id: subscription.id, notifyNewVideos: !subscription.notifyNewVideos })}
            onUnfollow={() => setLeaving(subscription)}
          />
        ))}
      </div>
      <ConfirmDialog
        open={leaving !== null}
        onOpenChange={(open) => { if (!open) setLeaving(null); }}
        title={`Unfollow ${leaving?.playlist.title}?`}
        description="Its videos leave your feed. Anything already downloaded stays in your library."
        confirmLabel="Unfollow"
        destructive
        busy={unfollow.isPending}
        onConfirm={() => { if (leaving) unfollow.mutate(leaving.id); }}
      />
    </section>
  );
}
