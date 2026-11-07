'use client';

import { use, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell, BellOff, ExternalLink, ListChecks, Loader2, MoreHorizontal, Plus, Radio, RefreshCw, SlidersHorizontal, Trash2 } from 'lucide-react';
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
import { ActionsMenu } from '@/components/creators/actions-menu';
import { ClampedText } from '@/components/creators/clamped-text';
import { CreatorAvatar } from '@/components/creators/creator-avatar';
import { CreatorVideoCard } from '@/components/creators/video-card';
import { CreatorVideoList, CreatorVideoSkeleton } from '@/components/creators/video-list';
import { useCreatorPlatform } from '@/components/creators/platform';
import { followedBy, showUnfollowNotice, turnOffAutoDownload, type UnfollowResult } from '@/components/creators/unfollow-notice';
import { whileDownloading, type CreatorVideoPage } from '@/components/creators/types';
import { useFeedLayout } from '@/components/creators/use-feed-view';
import { useVideoActions } from '@/components/creators/use-video-actions';
import { useVideoSelection } from '@/components/creators/use-video-selection';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { toCachedImageSrc } from '@/lib/image';
import { cn } from '@/lib/utils';

const HEADER_BUTTON = 'flex h-11 w-10 items-center justify-center text-primary';

interface Streamer {
  id: string;
  login: string;
  subscription: { id: string; notifyNewVods: boolean } | null;
  /** Only sent to someone who can change the rules. */
  followers?: number;
  displayName: string;
  description: string | null;
  profileImageUrl: string | null;
  offlineImageUrl: string | null;
  isLive: boolean;
  liveTitle: string | null;
  liveCategory?: string | null;
  /** Only platforms whose empty tabs should hide send this. */
  videoCounts?: Partial<Record<string, number>>;
}

export function CreatorPage({ params }: { params: Promise<{ id: string }> }) {
  const platform = useCreatorPlatform();
  // YouTube channels take the feed rails' tile size (owner, 2026-11-07); Twitch keeps YouTube-wide tiles.
  const tile = platform.id === 'youtube' ? 'rail' : 'wide';
  const { id } = use(params);
  const me = useMe();
  const canManage = hasCapability(me, platform.canManage);
  const view = useFeedLayout();
  const [pickedTab, setTab] = useRouteViewState<string>('tab', '');
  const [bannerFailed, setBannerFailed] = useState(false);
  const queryClient = useQueryClient();
  const actions = useVideoActions();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [platform.id] });

  const streamerQuery = useQuery({
    queryKey: [platform.id, 'streamer', id],
    queryFn: async ({ signal }) => {
      const res = await fetch(`${platform.creatorsApi}/${id}`, { signal });
      if (!res.ok) throw new Error('Failed to load');
      return (await res.json()) as Streamer;
    },
  });
  const streamer = streamerQuery.data;
  const counts = streamer?.videoCounts;
  const tabs = platform.creatorTabs.filter((item) => !counts || counts[item.id]);
  const tab = tabs.some((item) => item.id === pickedTab) ? pickedTab : (tabs[0] ?? platform.creatorTabs[0]).id;

  const videos = useRestorableInfiniteQuery({
    queryKey: [platform.id, 'streamer-videos', id, tab],
    queryFn: async ({ pageParam, signal }) => {
      const res = await fetch(`${platform.creatorsApi}/${id}/videos?type=${tab}&page=${pageParam}`, { signal });
      if (!res.ok) throw new Error('Failed to load videos');
      return (await res.json()) as CreatorVideoPage;
    },
    initialPageParam: 1,
    getNextPageParam: (last: CreatorVideoPage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
    refetchInterval: whileDownloading,
    refetchIntervalInBackground: false,
  });
  const rows = useMemo(() => videos.data?.pages.flatMap((page) => page.videos) ?? [], [videos.data]);
  const selection = useVideoSelection(rows, actions);

  const follow = useMutation({
    mutationFn: async () => {
      const leaving = Boolean(streamer?.subscription);
      const res = streamer?.subscription
        ? await fetch(`${platform.api}/subscriptions/${streamer.subscription.id}`, { method: 'DELETE' })
        : await fetch(platform.creatorsApi, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(platform.followBody(streamer?.login ?? '')),
          });
      if (!res.ok) throw new Error('Could not change the subscription');
      return leaving ? (await res.json().catch(() => null)) as UnfollowResult | null : null;
    },
    onSuccess: (result) => {
      void refresh();
      if (result && streamer) {
        showUnfollowNotice({
          done: platform.unfollowedLabel,
          name: streamer.displayName,
          result,
          turnOff: canManage ? () => turnOffAutoDownload(platform.id, streamer.id).then(refresh) : undefined,
        });
      }
    },
    onError: (error) => toast.error(error.message),
  });
  const toggleNotify = useMutation({
    mutationFn: async (notifyNewVods: boolean) => {
      const res = await fetch(`${platform.api}/subscriptions/${streamer?.subscription?.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ notifyNewVods }),
      });
      if (!res.ok) throw new Error('Could not change notifications');
    },
    onSuccess: () => void refresh(),
    onError: (error) => toast.error(error.message),
  });

  const getLatest = useMutation({
    mutationFn: async () => {
      const res = await fetch(`${platform.creatorsApi}/${id}/sync`, { method: 'POST' });
      const data = await res.json().catch(() => null);
      if (!res.ok) throw new Error(data?.error || 'Could not check for videos');
      return data as { found: number };
    },
    onSuccess: ({ found }) => {
      toast.success(found > 0 ? `Found ${found} new ${found === 1 ? 'video' : 'videos'}` : 'No new videos');
      void refresh();
    },
    onError: (error) => toast.error(error.message),
  });

  if (streamerQuery.isError) {
    return (
      <div className="animate-content-in">
        <PageHeader title={platform.creatorLabel} backHref={platform.creatorsPath} />
        <ErrorState message={`Couldn't load this ${platform.creatorLabel.toLowerCase()}`} onRetry={() => void streamerQuery.refetch()} />
      </div>
    );
  }

  const banner = toCachedImageSrc(streamer?.offlineImageUrl, undefined, { width: 1280 });
  const menu: ContextActionGroup[] = streamer ? [
    {
      id: 'open',
      actions: [
        ...(canManage && platform.autoDownload
          ? [{ id: 'rules', label: 'Download rules', icon: <SlidersHorizontal className="h-4 w-4" />, href: `${platform.creatorsPath}/${id}/rules` }]
          : []),
        ...(platform.id === 'youtube' ? [{ id: 'latest', label: 'Get latest videos', icon: <RefreshCw className="h-4 w-4" />, onSelect: () => getLatest.mutate() }] : []),
        { id: 'external', label: `Open on ${platform.name}`, icon: <ExternalLink className="h-4 w-4" />, href: platform.externalCreatorUrl(streamer), external: true },
      ],
    },
    {
      id: 'destructive',
      actions: streamer.subscription
        ? [{ id: 'unsubscribe', label: platform.unfollowLabel, icon: <Trash2 className="h-4 w-4" />, destructive: true, onSelect: () => follow.mutate() }]
        : [],
    },
  ] : [];

  const identity = streamer && (
    <>
      <h1 className="truncate text-xl font-bold leading-tight">{streamer.displayName}</h1>
      <p className="mt-0.5 truncate text-sm text-muted-foreground">
        @{streamer.login}
        {streamer.followers !== undefined && ` · ${followedBy(streamer.followers)}`}
      </p>
    </>
  );

  return (
    <>
      <PageHeader
        title={streamer?.displayName ?? platform.creatorLabel}
        backHref={platform.creatorsPath}
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
            <ActionsMenu label={`${streamer?.displayName ?? platform.creatorLabel} actions`} groups={menu} className={HEADER_BUTTON} icon={<MoreHorizontal className="h-5 w-5" />} />
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
              <CreatorAvatar url={streamer.profileImageUrl} size={80} className="shadow-lg ring-1 ring-border/20" />
              <div className="min-w-0 flex-1 pb-1">{identity}</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3.5 pt-3">
            <CreatorAvatar url={streamer.profileImageUrl} size={80} />
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
            {platform.followLabel}
          </Button>
        )}

        {streamer?.description && <ClampedText text={streamer.description} />}

        <Tabs value={tab} onValueChange={setTab}>
          {/* Waits for the counts, so that a tab with nothing in it never appears and then vanishes. */}
          {streamer ? (
            <TabsList className="w-full">
              {tabs.map((item) => <TabsTrigger key={item.id} value={item.id} className="flex-1">{item.label}</TabsTrigger>)}
            </TabsList>
          ) : <Skeleton className="h-9 w-full rounded-lg" />}
        </Tabs>

        {videos.isLoading ? (
          <CreatorVideoSkeleton tile={tile} />
        ) : videos.isError ? (
          <ErrorState compact message="Couldn't load the videos" onRetry={() => void videos.refetch()} />
        ) : rows.length === 0 ? (
          <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">No videos here.</div>
        ) : (
          <CreatorVideoList
            videos={rows}
            layout={view}
            tile={tile}
            renderVideo={(video) => (
              <CreatorVideoCard
                video={video}
                layout={view}
                showStreamer={false}
                actions={actions}
                selection={selection.selectionFor(video)}
                onSelect={selection.startWith(video)}
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
