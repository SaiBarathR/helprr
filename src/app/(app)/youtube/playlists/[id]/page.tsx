'use client';

import { use } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ExternalLink, ListChecks, Loader2, MoreHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';
import { ActionsMenu } from '@/components/creators/actions-menu';
import { ClampedText } from '@/components/creators/clamped-text';
import { followedBy, showUnfollowNotice, type UnfollowResult } from '@/components/creators/unfollow-notice';
import type { CreatorVideoPage } from '@/components/creators/types';
import { useFeedLayout } from '@/components/creators/use-feed-view';
import { useVideoActions } from '@/components/creators/use-video-actions';
import { useVideoSelection } from '@/components/creators/use-video-selection';
import { CreatorVideoCard } from '@/components/creators/video-card';
import { CreatorVideoList, CreatorVideoSkeleton } from '@/components/creators/video-list';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';

const HEADER_BUTTON = 'flex h-11 w-10 items-center justify-center text-primary';

interface Playlist {
  id: string;
  externalId: string;
  title: string;
  ownerName: string | null;
  description: string | null;
  itemCount: number;
  subscription: { id: string; notifyNewVideos: boolean } | null;
  /** Only sent to someone who can change the rules. */
  followers?: number;
}

export default function YoutubePlaylistPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const queryClient = useQueryClient();
  const view = useFeedLayout();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['youtube'] });

  const query = useQuery({
    queryKey: ['youtube', 'playlist', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/youtube/playlists/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load');
      return (await res.json()) as Playlist;
    },
  });
  const playlist = query.data;

  const videos = useRestorableInfiniteQuery({
    queryKey: ['youtube', 'playlist-videos', id],
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`/api/youtube/playlists/${id}/videos?page=${pageParam}`, { signal });
      if (!res.ok) throw new Error('Failed to load');
      return (await res.json()) as CreatorVideoPage;
    },
    initialPageParam: 1,
    getNextPageParam: (last: CreatorVideoPage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = videos.data?.pages.flatMap((page) => page.videos) ?? [];
  const actions = useVideoActions();
  const selection = useVideoSelection(rows, actions);

  const toggleNotify = useMutation({
    mutationFn: async (notifyNewVideos: boolean) => {
      const res = await fetch(`/api/youtube/playlist-subscriptions/${playlist?.subscription?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNewVideos }),
      });
      if (!res.ok) throw new Error('Could not change notifications');
    },
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message),
  });
  const unfollow = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/youtube/playlist-subscriptions/${playlist?.subscription?.id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Could not unfollow');
      return (await res.json().catch(() => null)) as UnfollowResult | null;
    },
    onSuccess: (result) => {
      void refresh();
      if (playlist) showUnfollowNotice({ done: 'Unfollowed', name: playlist.title, result });
    },
    onError: (error) => toast.error(error.message),
  });

  if (query.isError) {
    return (
      <>
        <PageHeader title="Playlist" backHref="/youtube/channels" />
        <ErrorState message="Couldn't load this playlist" onRetry={() => void query.refetch()} />
      </>
    );
  }

  const menu: ContextActionGroup[] = playlist ? [
    {
      id: 'open',
      actions: [{
        id: 'external',
        label: 'Open on YouTube',
        icon: <ExternalLink className="h-4 w-4" />,
        href: `https://www.youtube.com/playlist?list=${playlist.externalId}`,
        external: true,
      }],
    },
    {
      id: 'destructive',
      actions: playlist.subscription
        ? [{ id: 'unfollow', label: 'Unfollow', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => unfollow.mutate() }]
        : [],
    },
  ] : [];

  return (
    <>
      <PageHeader
        title={playlist?.title ?? 'Playlist'}
        backHref="/youtube/channels"
        rightContent={(
          <>
            {selection.canSelect && (
              <button type="button" aria-label={selection.active ? 'Exit selection' : 'Select videos'} aria-pressed={selection.active} onClick={selection.toggleMode} className={HEADER_BUTTON}>
                <ListChecks className="h-5 w-5" />
              </button>
            )}
            {playlist?.subscription && (
              <button
                type="button"
                aria-label={playlist.subscription.notifyNewVideos ? 'Turn off notifications' : 'Turn on notifications'}
                aria-pressed={playlist.subscription.notifyNewVideos}
                onClick={() => toggleNotify.mutate(!playlist.subscription!.notifyNewVideos)}
                className={HEADER_BUTTON}
              >
                {playlist.subscription.notifyNewVideos ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
              </button>
            )}
            <ActionsMenu label={`${playlist?.title ?? 'Playlist'} actions`} groups={menu} className={HEADER_BUTTON} icon={<MoreHorizontal className="h-5 w-5" />} />
          </>
        )}
      />
      <div className="space-y-4 animate-content-in">
        <PullToRefresh onRefresh={refresh} disabled={selection.active} />
        {playlist && (
          <div className="pt-2">
            <h1 className="text-xl font-bold leading-tight">{playlist.title}</h1>
            <p className="mt-0.5 truncate text-sm text-muted-foreground">
              {[
                playlist.ownerName,
                `${playlist.itemCount} ${playlist.itemCount === 1 ? 'video' : 'videos'}`,
                playlist.followers !== undefined && followedBy(playlist.followers),
              ].filter(Boolean).join(' · ')}
            </p>
          </div>
        )}
        {playlist?.description && <ClampedText text={playlist.description} />}

        {videos.isLoading ? (
          <CreatorVideoSkeleton />
        ) : videos.isError ? (
          <ErrorState compact message="Couldn't load the videos" onRetry={() => void videos.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">No videos here.</div>
        ) : (
          <CreatorVideoList
            videos={rows}
            layout={view}
            renderVideo={(video) => (
              <CreatorVideoCard video={video} layout={view} actions={actions} selection={selection.selectionFor(video)} onSelect={selection.startWith(video)} />
            )}
          />
        )}
        {videos.hasNextPage && (
          <Button variant="ghost" className="w-full" disabled={videos.isFetchingNextPage} onClick={() => void videos.fetchNextPage()}>
            {videos.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Load more
          </Button>
        )}
      </div>
      {actions.sheet}
      {selection.bar}
    </>
  );
}
