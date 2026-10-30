'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, CheckSquare, Radio } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { FadeInImage } from '@/components/media/fade-in-image';
import { Button } from '@/components/ui/button';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { useMe, hasCapability } from '@/components/permission-provider';
import { StreamerRules } from '@/components/twitch/streamer-rules';
import { TwitchVideoCard } from '@/components/twitch/twitch-video-card';
import { TwitchVideoList } from '@/components/twitch/twitch-video-list';
import { useVideoActions } from '@/components/twitch/use-video-actions';
import type { TwitchVideoPage } from '@/components/twitch/types';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { toCachedImageSrc } from '@/lib/image';
import { useBulkSelection } from '@/lib/use-bulk-selection';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'ARCHIVE', label: 'Videos' },
  { id: 'HIGHLIGHT', label: 'Highlights' },
  { id: 'UPLOAD', label: 'Uploads' },
  { id: 'RULES', label: 'Rules' },
] as const;

interface Streamer {
  id: string;
  login: string;
  subscription: { id: string; notifyNewVods: boolean } | null;
  displayName: string;
  description: string | null;
  profileImageUrl: string | null;
  offlineImageUrl: string | null;
  isLive: boolean;
  liveTitle: string | null;
  liveCategory: string | null;
}

export default function TwitchStreamerPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const me = useMe();
  const tabs = TABS.filter((item) => item.id !== 'RULES' || hasCapability(me, 'twitch.manage'));
  const [tab, setTab] = useState<(typeof TABS)[number]['id']>('ARCHIVE');

  const canDownload = hasCapability(me, 'twitch.download');
  const canManage = hasCapability(me, 'twitch.manage');
  const selection = useBulkSelection();
  const actions = useVideoActions();
  const queryClient = useQueryClient();
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

  const streamerQuery = useQuery({
    queryKey: ['twitch', 'streamer', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`/api/twitch/streamers/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load streamer');
      return (await res.json()) as Streamer;
    },
  });
  const streamer = streamerQuery.data;

  const videos = useRestorableInfiniteQuery({
    queryKey: ['twitch', 'streamer-videos', id, tab],
    enabled: tab !== 'RULES',
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`/api/twitch/streamers/${id}/videos?type=${tab}&page=${pageParam}`, { signal });
      if (!res.ok) throw new Error('Failed to load videos');
      return (await res.json()) as TwitchVideoPage;
    },
    initialPageParam: 1,
    getNextPageParam: (last: TwitchVideoPage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => videos.data?.pages.flatMap((page) => page.videos) ?? [], [videos.data]);
  const selected = rows.filter((video) => selection.selectedKeys.has(video.id));
  const toDelete = selected.filter((video) => video.fileId);
  const toDownload = selected.filter((video) => !video.fileId);

  const follow = useMutation({
    mutationFn: async () => {
      const res = streamer?.subscription
        ? await fetch(`/api/twitch/subscriptions/${streamer.subscription.id}`, { method: 'DELETE' })
        : await fetch('/api/twitch/streamers', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ login: streamer?.login }),
          });
      if (!res.ok) throw new Error('Could not change the subscription');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['twitch'] }),
    onError: (error) => toast.error(error.message),
  });
  const toggleNotify = useMutation({
    mutationFn: async (notifyNewVods: boolean) => {
      const res = await fetch(`/api/twitch/subscriptions/${streamer?.subscription?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNewVods }),
      });
      if (!res.ok) throw new Error('Could not change notifications');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['twitch'] }),
    onError: (error) => toast.error(error.message),
  });

  const banner = toCachedImageSrc(streamer?.offlineImageUrl, undefined, { width: 1200 });
  const avatar = toCachedImageSrc(streamer?.profileImageUrl, undefined, { width: 144 });

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title={streamer?.displayName ?? 'Streamer'} backHref="/twitch/streamers" />
      <div className="relative h-32 overflow-hidden bg-muted sm:h-44">
        {banner && <FadeInImage src={banner} alt="" fill sizes="100vw" className="object-cover" unoptimized />}
        <div className="absolute inset-0 bg-gradient-to-t from-background to-transparent" />
      </div>
      <div className="relative -mt-8 space-y-4 px-4">
        <div className="flex items-end gap-3">
          <span className="relative block h-16 w-16 shrink-0 overflow-hidden rounded-full bg-muted ring-2 ring-background">
            {avatar && <FadeInImage src={avatar} alt="" fill sizes="64px" className="object-cover" unoptimized />}
          </span>
          {streamer?.isLive && (
            <span className="flex min-w-0 items-center gap-1 pb-1 text-xs text-red-400">
              <Radio className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{streamer.liveTitle || 'Live'}{streamer.liveCategory ? ` · ${streamer.liveCategory}` : ''}</span>
            </span>
          )}
        </div>
        {streamer && (
          <div className="flex gap-2">
            <Button variant={streamer.subscription ? 'outline' : 'default'} className="h-11 flex-1" disabled={follow.isPending} onClick={() => follow.mutate()}>
              {streamer.subscription ? 'Unsubscribe' : 'Subscribe'}
            </Button>
            {streamer.subscription && (
              <Button
                variant="outline"
                size="icon"
                className="h-11 w-11"
                aria-label={streamer.subscription.notifyNewVods ? 'Turn off notifications' : 'Turn on notifications'}
                aria-pressed={streamer.subscription.notifyNewVods}
                onClick={() => toggleNotify.mutate(!streamer.subscription!.notifyNewVods)}
              >
                {streamer.subscription.notifyNewVods ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4 text-muted-foreground" />}
              </Button>
            )}
          </div>
        )}
        {streamer?.description && <p className="text-sm text-muted-foreground">{streamer.description}</p>}

        <div role="tablist" aria-label="Video types" className="grid grid-flow-col auto-cols-fr gap-1 rounded-md bg-muted/40 p-1">
          {tabs.map((item) => (
            <button
              key={item.id}
              role="tab"
              aria-selected={tab === item.id}
              onClick={() => setTab(item.id)}
              className={cn('min-h-9 rounded text-sm font-medium', tab === item.id ? 'bg-background shadow-sm' : 'text-muted-foreground')}
            >
              {item.label}
            </button>
          ))}
        </div>

        {tab === 'RULES' && <StreamerRules streamerId={id} />}
        {tab !== 'RULES' && videos.isSuccess && rows.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">No videos here.</p>
        )}
        {tab !== 'RULES' && rows.length > 0 && (canDownload || canManage) && (
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={() => (selection.selectionMode ? selection.exit() : selection.enter())}>
              <CheckSquare className="mr-1.5 h-4 w-4" />
              {selection.selectionMode ? 'Cancel' : 'Select'}
            </Button>
          </div>
        )}
        {tab !== 'RULES' && (
          <TwitchVideoList
            videos={rows}
            layout="grid"
            renderVideo={(video) => (
              <TwitchVideoCard
                video={video}
                layout="grid"
                showStreamer={false}
                actions={actions}
                selection={selection.selectionMode && !video.activeJob && (video.downloaded ? canManage : canDownload)
                  ? { selected: selection.selectedKeys.has(video.id), onToggle: () => selection.toggle(video.id) }
                  : undefined}
              />
            )}
          />
        )}
        {videos.hasNextPage && (
          <Button variant="outline" className="w-full" disabled={videos.isFetchingNextPage} onClick={() => void videos.fetchNextPage()}>
            {videos.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>
      {actions.sheet}
      {selection.selectionMode && selection.count > 0 && (
        <FloatingActionBar>
          <span className="text-sm">{selection.count} selected</span>
          {toDelete.length > 0 && (
            <Button
              variant="outline"
              className="ml-auto"
              onClick={() => {
                actions.deleteFiles(toDelete);
                selection.exit();
              }}
            >
              Delete {toDelete.length}
            </Button>
          )}
          {toDownload.length > 0 && (
            <Button className={toDelete.length > 0 ? undefined : 'ml-auto'} disabled={downloadSelected.isPending} onClick={() => downloadSelected.mutate()}>
              {downloadSelected.isPending ? 'Queuing…' : `Download ${toDownload.length}`}
            </Button>
          )}
        </FloatingActionBar>
      )}
    </div>
  );
}
