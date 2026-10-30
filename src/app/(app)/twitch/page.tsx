'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, LayoutGrid, List, Radio, SlidersHorizontal } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { PageHeader } from '@/components/layout/page-header';
import { SearchInput } from '@/components/media/search-input';
import { useMe, hasCapability } from '@/components/permission-provider';
import { Button } from '@/components/ui/button';
import { ActiveFilterBar, FilterDot, filterButtonLabel, searchFilter, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { Skeleton } from '@/components/ui/skeleton';
import { TwitchSubNav } from '@/components/twitch/twitch-subnav';
import { TwitchVideoCard } from '@/components/twitch/twitch-video-card';
import { TwitchVideoList } from '@/components/twitch/twitch-video-list';
import { useVideoActions } from '@/components/twitch/use-video-actions';
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

const SINCE = [
  { id: '', label: 'Any date' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'quarter', label: 'Past 3 months' },
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
  const [since, setSince] = useState('');
  const [category, setCategory] = useState('');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [streamer, setStreamer] = useState('');
  const [search, setSearch] = useState('');

  const filters = useMemo(() => {
    const params = new URLSearchParams({ segment, pageSize: String(PAGE_SIZE) });
    for (const [key, value] of Object.entries(CHIPS.find((item) => item.id === chip)?.params ?? {})) {
      params.set(key, value as string);
    }
    if (length) params.set('length', length);
    if (since) params.set('since', since);
    if (category) params.set('category', category);
    if (streamer) params.set('streamer', streamer);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [segment, chip, length, since, category, streamer, search]);

  const me = useMe();
  const canManage = hasCapability(me, 'twitch.manage');
  const autoSettings = useQuery({
    queryKey: ['twitch', 'settings'],
    queryFn: ({ signal }) => getJson<{ autoDownloadEnabled: boolean }>('/api/twitch/settings', signal),
    enabled: canManage,
  });

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

  const expiringQuery = useQuery({
    queryKey: ['twitch', 'feed', 'expiring-shelf'],
    queryFn: ({ signal }) => getJson<TwitchVideoPage>('/api/twitch/feed?expiring=1&notDownloaded=1&pageSize=12', signal),
  });
  const expiring = expiringQuery.data?.videos ?? [];
  const categories = feed.data?.pages[0]?.categories ?? [];
  const actions = useVideoActions();

  const activeFilters: ActiveFilter[] = [
    ...searchFilter(search, () => setSearch('')),
    ...(streamer ? [{ id: 'streamer', label: subscriptions.find((item) => item.streamer.id === streamer)?.streamer.displayName ?? 'Streamer', onRemove: () => setStreamer('') }] : []),
    ...(category ? [{ id: 'category', label: category, onRemove: () => setCategory('') }] : []),
    ...(length ? [{ id: 'length', label: LENGTHS.find((item) => item.id === length)?.label ?? length, onRemove: () => setLength('') }] : []),
    ...(since ? [{ id: 'since', label: SINCE.find((item) => item.id === since)?.label ?? since, onRemove: () => setSince('') }] : []),
  ];
  const clearFilters = () => {
    setSearch('');
    setStreamer('');
    setCategory('');
    setLength('');
    setSince('');
  };

  // The list is virtual, so a sentinel under it asks for the next page.
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = feed;
  useEffect(() => {
    const sentinel = loadMoreRef.current;
    if (!sentinel || !hasNextPage) return;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !isFetchingNextPage) void fetchNextPage();
    }, { rootMargin: '800px' });
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

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
      <PullToRefresh onRefresh={() => queryClient.invalidateQueries({ queryKey: ['twitch'] })} />
      <PageHeader title="Twitch" showBack={false} rightContent={<TwitchSubNav active="feed" />} />

      <div className="space-y-3 px-4 pt-2">
        <div className="flex items-center gap-2">
          <SearchInput
            value={search}
            onChange={setSearch}
            historyKey="twitch-feed"
            clearable
            placeholder="Search videos and streamers"
            aria-label="Search videos and streamers"
            wrapperClassName="min-w-0 flex-1"
            className="h-10 rounded-full"
          />
          <Button variant="outline" size="icon" className="relative h-10 w-10 shrink-0 rounded-full" aria-label={filterButtonLabel('Filters', activeFilters.length > 0)} onClick={() => setFiltersOpen(true)}>
            <SlidersHorizontal className="h-4 w-4" />
            <FilterDot active={activeFilters.length > 0} />
          </Button>
        </div>
        <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} />

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

        {canManage && autoSettings.data?.autoDownloadEnabled === false && (
          <Link href="/settings/twitch" className="press-feedback block rounded-xl bg-card p-3 text-sm">
            <span className="font-medium">Auto-download is off.</span>{' '}
            <span className="text-muted-foreground">Nothing downloads by itself. Pick what to save, or set rules.</span>
          </Link>
        )}

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

        {expiring.length > 0 && segment === 'all' && (
          <section aria-label="Expiring soon">
            <h2 className="mb-1.5 font-mono text-[11px] uppercase tracking-widest text-muted-foreground">Expiring soon</h2>
            <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-1 no-scrollbar">
              {expiring.map((video) => (
                <div key={video.id} className="w-60 shrink-0"><TwitchVideoCard video={video} layout="grid" actions={actions} /></div>
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
          <TwitchVideoList
            videos={videos}
            layout={view}
            renderVideo={(video) => <TwitchVideoCard video={video} layout={view} actions={actions} />}
          />
        )}

        <div ref={loadMoreRef} aria-hidden className="h-1" />
        {feed.isFetchingNextPage && <p className="py-2 text-center text-sm text-muted-foreground">Loading…</p>}
      </div>
      {actions.sheet}
      <Drawer open={filtersOpen} onOpenChange={setFiltersOpen}>
        <DrawerContent>
          <DrawerHeader><DrawerTitle>Filters</DrawerTitle></DrawerHeader>
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        <div className="grid grid-cols-1 gap-2">
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
          <select
            aria-label="Date"
            value={since}
            onChange={(event) => setSince(event.target.value)}
            className="h-10 min-w-0 rounded-md border border-border bg-card px-2 text-sm"
          >
            {SINCE.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
          <select
            aria-label="Category"
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-10 min-w-0 rounded-md border border-border bg-card px-2 text-sm"
          >
            <option value="">All categories</option>
            {categories.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>
          </div>
        </DrawerContent>
      </Drawer>
    </div>
  );
}
