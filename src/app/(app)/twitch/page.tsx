'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, LayoutGrid, List, Radio } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { TwitchSubNav } from '@/components/twitch/twitch-subnav';
import { TwitchVideoCard } from '@/components/twitch/twitch-video-card';
import type { TwitchVideoPage } from '@/components/twitch/types';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 30;
const CHIPS = [
  { id: 'all', label: 'All', params: {} },
  { id: 'archives', label: 'Past broadcasts', params: { type: 'ARCHIVE' } },
  { id: 'highlights', label: 'Highlights', params: { type: 'HIGHLIGHT' } },
  { id: 'uploads', label: 'Uploads', params: { type: 'UPLOAD' } },
  { id: 'expiring', label: 'Expiring', params: { expiring: '1' } },
  { id: 'not-downloaded', label: 'Not downloaded', params: { notDownloaded: '1' } },
] as const;
const LENGTHS = [
  { id: '', label: 'Any length' },
  { id: 'short', label: 'Under 1 h' },
  { id: 'medium', label: '1–3 h' },
  { id: 'long', label: 'Over 3 h' },
] as const;

interface StreamerList {
  subscriptions: Array<{
    id: string;
    streamer: { id: string; displayName: string; isLive: boolean; liveTitle: string | null };
  }>;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Failed to load Twitch data');
  return res.json() as Promise<T>;
}

export default function TwitchFeedPage() {
  const queryClient = useQueryClient();
  const view = useUIStore((state) => state.twitchFeedView);
  const setView = useUIStore((state) => state.setTwitchFeedView);
  const [segment, setSegment] = useState<'new' | 'all'>('all');
  const [chip, setChip] = useState<(typeof CHIPS)[number]['id']>('all');
  const [length, setLength] = useState('');
  const [streamer, setStreamer] = useState('');
  const [search, setSearch] = useState('');

  const filters = useMemo(() => {
    const params = new URLSearchParams({ segment, pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries(CHIPS.find((item) => item.id === chip)?.params ?? {})) {
      params.set(key, value as string);
    }
    if (length) params.set('length', length);
    if (streamer) params.set('streamer', streamer);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [segment, chip, length, streamer, search]);

  const streamersQuery = useQuery({
    queryKey: ['twitch', 'streamers'],
    queryFn: ({ signal }) => getJson<StreamerList>('/api/twitch/streamers', signal),
  });
  const subscriptions = streamersQuery.data?.subscriptions ?? [];
  const live = subscriptions.filter((subscription) => subscription.streamer.isLive);

  const feed = useRestorableInfiniteQuery({
    queryKey: ['twitch', 'feed', filters],
    queryFn: ({ pageParam, signal }) => getJson<TwitchVideoPage>(`/api/twitch/feed?${filters}&page=${pageParam}`, signal),
    initialPageParam: 1,
    getNextPageParam: (last: TwitchVideoPage) => (last.page * last.pageSize < last.total ? last.page + 1 : undefined),
  });
  const videos = useMemo(() => feed.data?.pages.flatMap((page) => page.videos) ?? [], [feed.data]);

  const markSeen = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/twitch/feed/seen', { method: 'POST' });
      if (!res.ok) throw new Error('Could not mark the feed as seen');
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['twitch', 'feed'] }),
    onError: (error) => toast.error(error.message),
  });

  return (
    <div className="animate-content-in pb-8">
      <PageHeader title="Twitch" showBack={false} rightContent={<TwitchSubNav active="feed" />} />

      <div className="space-y-3 px-4 pt-2">
        <Input
          type="search"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search videos and streamers"
          aria-label="Search videos and streamers"
          className="h-10 rounded-full"
        />

        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Feed segment" className="grid grid-cols-2 gap-1 rounded-md bg-muted/40 p-1">
            {(['all', 'new'] as const).map((value) => (
              <button
                key={value}
                role="tab"
                aria-selected={segment === value}
                onClick={() => setSegment(value)}
                className={cn('min-h-9 rounded px-4 text-sm font-medium', segment === value ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                {value === 'all' ? 'All' : 'New'}
              </button>
            ))}
          </div>
          {segment === 'new' && (
            <Button variant="ghost" size="sm" disabled={markSeen.isPending} onClick={() => markSeen.mutate()}>
              <CheckCheck className="mr-1.5 h-4 w-4" />
              Mark all seen
            </Button>
          )}
          <div className="ml-auto flex gap-0.5 rounded-lg bg-muted/50 p-0.5">
            {([['grid', LayoutGrid, 'Grid'], ['list', List, 'List']] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                aria-label={label}
                aria-pressed={view === value}
                onClick={() => setView(value)}
                className={cn('flex min-h-[40px] min-w-[40px] items-center justify-center rounded-md', view === value ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                <Icon className="h-4 w-4" />
              </button>
            ))}
          </div>
        </div>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
          {CHIPS.map((item) => (
            <button
              key={item.id}
              aria-pressed={chip === item.id}
              onClick={() => setChip(item.id)}
              className={cn(
                'min-h-9 shrink-0 rounded-full border px-3 text-sm',
                chip === item.id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground',
              )}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-2">
          <select
            aria-label="Streamer"
            value={streamer}
            onChange={(event) => setStreamer(event.target.value)}
            className="h-10 min-w-0 rounded-md border border-border bg-card px-2 text-sm"
          >
            <option value="">All streamers</option>
            {subscriptions.map(({ streamer: item }) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
          <select
            aria-label="Length"
            value={length}
            onChange={(event) => setLength(event.target.value)}
            className="h-10 min-w-0 rounded-md border border-border bg-card px-2 text-sm"
          >
            {LENGTHS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </div>

        {live.length > 0 && segment === 'all' && (
          <section aria-label="Live now">
            <h2 className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Live now</h2>
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
              {live.map(({ streamer: item }) => (
                <Link key={item.id} href={`/twitch/streamers/${item.id}`} className="press-feedback flex min-h-9 shrink-0 items-center gap-1.5 rounded-full bg-card px-3 text-sm">
                  <Radio className="h-3.5 w-3.5 text-red-500" />
                  {item.displayName}
                </Link>
              ))}
            </div>
          </section>
        )}

        {feed.isLoading ? (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {Array.from({ length: 6 }, (_, index) => <Skeleton key={index} className="aspect-video rounded-xl" />)}
          </div>
        ) : feed.isError ? (
          <p className="py-12 text-center text-sm text-muted-foreground">Could not load the feed.</p>
        ) : videos.length === 0 ? (
          <p className="py-12 text-center text-sm text-muted-foreground">
            {subscriptions.length === 0 ? 'Subscribe to a streamer to fill your feed.' : 'Nothing here yet.'}
          </p>
        ) : (
          <div className={cn(view === 'grid' ? 'grid grid-cols-1 gap-x-4 gap-y-5 sm:grid-cols-2 xl:grid-cols-3' : 'space-y-3')}>
            {videos.map((video) => <TwitchVideoCard key={video.id} video={video} layout={view} />)}
          </div>
        )}

        {feed.hasNextPage && (
          <Button variant="outline" className="w-full" disabled={feed.isFetchingNextPage} onClick={() => void feed.fetchNextPage()}>
            {feed.isFetchingNextPage ? 'Loading…' : 'Load more'}
          </Button>
        )}
      </div>
    </div>
  );
}
