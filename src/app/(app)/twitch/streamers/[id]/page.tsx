'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ExternalLink, ListChecks, Loader2, MoreHorizontal, Plus, Radio, SlidersHorizontal, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/layout/page-header';
import { useMe, hasCapability } from '@/components/permission-provider';
import { HeroImage } from '@/components/media/hero-image';
import { Button } from '@/components/ui/button';
import { ErrorState } from '@/components/ui/error-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import type { ContextActionGroup } from '@/components/ui/quick-context-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActionsMenu } from '@/components/twitch/actions-menu';
import { StreamerAvatar } from '@/components/twitch/streamer-avatar';
import { TwitchVideoCard } from '@/components/twitch/twitch-video-card';
import { TwitchVideoList, TwitchVideoSkeleton } from '@/components/twitch/twitch-video-list';
import type { TwitchVideoPage } from '@/components/twitch/types';
import { useVideoActions } from '@/components/twitch/use-video-actions';
import { useVideoSelection } from '@/components/twitch/use-video-selection';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { toCachedImageSrc } from '@/lib/image';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const TABS = [
  { id: 'ARCHIVE', label: 'Videos' },
  { id: 'HIGHLIGHT', label: 'Highlights' },
  { id: 'UPLOAD', label: 'Uploads' },
] as const;

// Three lines on a phone: anything shorter has nothing to reveal.
const READ_MORE_AT = 140;
const HEADER_BUTTON = 'flex h-11 w-10 items-center justify-center text-primary';

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
  const canManage = hasCapability(me, 'twitch.manage');
  const view = useUIStore((state) => state.twitchFeedView);
  const [tab, setTab] = useRouteViewState<string>('tab', 'ARCHIVE');
  const [aboutOpen, setAboutOpen] = useState(false);
  const [bannerFailed, setBannerFailed] = useState(false);
  const queryClient = useQueryClient();
  const actions = useVideoActions();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['twitch'] });

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
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`/api/twitch/streamers/${id}/videos?type=${tab}&page=${pageParam}`, { signal });
      if (!res.ok) throw new Error('Failed to load videos');
      return (await res.json()) as TwitchVideoPage;
    },
    initialPageParam: 1,
    getNextPageParam: (last: TwitchVideoPage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const rows = useMemo(() => videos.data?.pages.flatMap((page) => page.videos) ?? [], [videos.data]);
  const selection = useVideoSelection(rows, actions);

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
    onSuccess: () => void refresh(),
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
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message),
  });

  if (streamerQuery.isError) {
    return (
      <div className="animate-content-in">
        <PageHeader title="Streamer" backHref="/twitch/streamers" />
        <ErrorState message="Couldn't load this streamer" onRetry={() => void streamerQuery.refetch()} />
      </div>
    );
  }

  const banner = toCachedImageSrc(streamer?.offlineImageUrl, undefined, { width: 1280 });
  const menu: ContextActionGroup[] = streamer ? [
    {
      id: 'open',
      actions: [
        ...(canManage
          ? [{ id: 'rules', label: 'Download rules', icon: <SlidersHorizontal className="h-4 w-4" />, href: `/twitch/streamers/${id}/rules` }]
          : []),
        { id: 'twitch', label: 'Open on Twitch', icon: <ExternalLink className="h-4 w-4" />, href: `https://www.twitch.tv/${streamer.login}`, external: true },
      ],
    },
    {
      id: 'destructive',
      actions: streamer.subscription
        ? [{ id: 'unsubscribe', label: 'Unsubscribe', icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => follow.mutate() }]
        : [],
    },
  ] : [];

  const identity = streamer && (
    <>
      <h1 className="truncate text-xl font-bold leading-tight">{streamer.displayName}</h1>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">@{streamer.login}</p>
    </>
  );

  return (
    <>
      <PageHeader
        title={streamer?.displayName ?? 'Streamer'}
        backHref="/twitch/streamers"
        rightContent={(
          <>
            {selection.canSelect && rows.length > 0 && (
              <button
                type="button"
                aria-label={selection.active ? 'Exit selection' : 'Select videos'}
                aria-pressed={selection.active}
                onClick={selection.toggleMode}
                className={cn(HEADER_BUTTON, selection.active && 'rounded-lg bg-primary text-primary-foreground')}
              >
                <ListChecks className="h-5 w-5" />
              </button>
            )}
            {streamer?.subscription && (
              <button
                type="button"
                aria-label={streamer.subscription.notifyNewVods ? 'Turn off notifications' : 'Turn on notifications'}
                aria-pressed={streamer.subscription.notifyNewVods}
                onClick={() => toggleNotify.mutate(!streamer.subscription!.notifyNewVods)}
                className={HEADER_BUTTON}
              >
                {streamer.subscription.notifyNewVods ? <Bell className="h-5 w-5" /> : <BellOff className="h-5 w-5 text-muted-foreground" />}
              </button>
            )}
            <ActionsMenu label={`${streamer?.displayName ?? 'Streamer'} actions`} groups={menu} className={HEADER_BUTTON} icon={<MoreHorizontal className="h-5 w-5" />} />
          </>
        )}
      />
      <div className="space-y-4 animate-content-in">
        <PullToRefresh onRefresh={refresh} disabled={selection.active} />
        {!streamer ? (
          <div className="flex items-center gap-3 pt-3">
            <Skeleton className="h-20 w-20 rounded-full" />
            <div className="flex-1 space-y-2"><Skeleton className="h-5 w-1/2" /><Skeleton className="h-3 w-1/3" /></div>
          </div>
        ) : banner && !bannerFailed ? (
          <div className="-mx-2 md:-mx-6">
            <div className="relative h-[180px] w-full overflow-hidden bg-muted/40 md:h-[220px]">
              <HeroImage src={banner} alt="" fill sizes="100vw" className="object-cover" priority unoptimized onError={() => setBannerFailed(true)} />
              <div className="absolute inset-0 bg-gradient-to-t from-background via-background/60 to-transparent light:via-background/25" />
            </div>
            <div className="relative -mt-[52px] flex items-end gap-3.5 px-2 md:px-6">
              <StreamerAvatar url={streamer.profileImageUrl} size={80} className="shadow-lg ring-1 ring-border/20" />
              <div className="min-w-0 flex-1 pb-1">{identity}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3.5 pt-3">
            <StreamerAvatar url={streamer.profileImageUrl} size={80} />
            <div className="min-w-0 flex-1">{identity}</div>
          </div>
        )}

        {streamer?.isLive && (
          <p className="flex items-center gap-1.5 text-sm text-red-400">
            <Radio className="h-4 w-4 shrink-0" />
            <span className="min-w-0 truncate">{streamer.liveTitle || 'Live'}{streamer.liveCategory ? ` · ${streamer.liveCategory}` : ''}</span>
          </p>
        )}

        {streamer && !streamer.subscription && (
          <Button className="h-10 w-full rounded-full" disabled={follow.isPending} onClick={() => follow.mutate()}>
            {follow.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Subscribe
          </Button>
        )}

        {streamer?.description && (
          <div>
            <p className={cn('text-sm leading-relaxed text-muted-foreground', !aboutOpen && 'line-clamp-3')}>{streamer.description}</p>
            {streamer.description.length > READ_MORE_AT && (
              <button type="button" onClick={() => setAboutOpen(!aboutOpen)} className="mt-1 text-sm font-medium text-primary">
                {aboutOpen ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="w-full">
            {TABS.map((item) => <TabsTrigger key={item.id} value={item.id} className="flex-1">{item.label}</TabsTrigger>)}
          </TabsList>
        </Tabs>

        {videos.isLoading ? (
          <TwitchVideoSkeleton />
        ) : videos.isError ? (
          <ErrorState compact message="Couldn't load the videos" onRetry={() => void videos.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">No videos here.</div>
        ) : (
          <TwitchVideoList
            videos={rows}
            layout={view}
            renderVideo={(video) => (
              <TwitchVideoCard
                video={video}
                layout={view}
                showStreamer={false}
                actions={actions}
                selection={selection.selectionFor(video)}
                onSelect={selection.canSelect ? () => selection.startWith(video) : undefined}
              />
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
