'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, ChevronRight, Filter, ListChecks, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import Link from '@/components/ui/app-link';
import { useMe, hasCapability } from '@/components/permission-provider';
import { FadeInImage } from '@/components/media/fade-in-image';
import { SearchBar } from '@/components/media/search-bar';
import { ViewSelector } from '@/components/media/view-selector';
import { ActiveFilterBar, FilterDot, filterButtonLabel, searchFilter, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/error-state';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { FilterGroup, type FilterOption } from '@/components/twitch/filter-group';
import { ToolbarButton, toolbarButtonClass, TwitchToolbar } from '@/components/twitch/twitch-toolbar';
import { TwitchVideoCard } from '@/components/twitch/twitch-video-card';
import { TwitchVideoList, TwitchVideoSkeleton } from '@/components/twitch/twitch-video-list';
import type { TwitchVideoPage } from '@/components/twitch/types';
import { useVideoActions } from '@/components/twitch/use-video-actions';
import { useVideoSelection } from '@/components/twitch/use-video-selection';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { toCachedImageSrc } from '@/lib/image';
import { useUIStore } from '@/lib/store';

const PAGE_SIZE = 30;

const SHOW: FilterOption[] = [{ id: 'all', label: 'All videos' }, { id: 'new', label: 'New' }];
const TYPES: FilterOption[] = [
  { id: '', label: 'Any type' },
  { id: 'ARCHIVE', label: 'Past broadcasts' },
  { id: 'HIGHLIGHT', label: 'Highlights' },
  { id: 'UPLOAD', label: 'Uploads' },
];
const STATUSES: FilterOption[] = [
  { id: '', label: 'Any status' },
  { id: 'expiring', label: 'Expiring' },
  { id: 'notDownloaded', label: 'Not downloaded' },
  { id: 'downloaded', label: 'Downloaded' },
];
const LENGTHS: FilterOption[] = [
  { id: '', label: 'Any length' },
  { id: 'short', label: 'Under 1 h' },
  { id: 'medium', label: '1–3 h' },
  { id: 'long', label: 'Over 3 h' },
];
const SINCE: FilterOption[] = [
  { id: '', label: 'Any date' },
  { id: 'week', label: 'Past week' },
  { id: 'month', label: 'Past month' },
  { id: 'quarter', label: 'Past 3 months' },
];

interface StreamerList {
  subscriptions: Array<{
    id: string;
    streamer: {
      id: string;
      displayName: string;
      profileImageUrl: string | null;
      isLive: boolean;
      liveTitle: string | null;
      liveCategory: string | null;
    };
  }>;
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Failed to load Twitch data');
  return res.json() as Promise<T>;
}

function picked(id: string, value: string, options: FilterOption[], clear: () => void): ActiveFilter[] {
  const option = options.find((item) => item.id === value);
  return value && option ? [{ id, label: option.label, onRemove: clear }] : [];
}

export default function TwitchFeedPage() {
  const queryClient = useQueryClient();
  const view = useUIStore((state) => state.twitchFeedView);
  const setView = useUIStore((state) => state.setTwitchFeedView);
  const [show, setShow] = useRouteViewState('show', 'all');
  const [type, setType] = useRouteViewState('type', '');
  const [status, setStatus] = useRouteViewState('status', '');
  const [length, setLength] = useRouteViewState('length', '');
  const [since, setSince] = useRouteViewState('since', '');
  const [category, setCategory] = useRouteViewState('category', '');
  const [streamer, setStreamer] = useRouteViewState('streamer', '');
  const [search, setSearch] = useRouteViewState('search', '');

  const filters = useMemo(() => {
    const params = new URLSearchParams({ segment: show, pageSize: String(PAGE_SIZE) });
    if (type) params.set('type', type);
    if (status) params.set(status, '1');
    if (length) params.set('length', length);
    if (since) params.set('since', since);
    if (category) params.set('category', category);
    if (streamer) params.set('streamer', streamer);
    if (search.trim()) params.set('q', search.trim());
    return params.toString();
  }, [show, type, status, length, since, category, streamer, search]);

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
  const total = feed.data?.pages[0]?.total ?? 0;

  const expiringQuery = useQuery({
    queryKey: ['twitch', 'feed', 'expiring-shelf'],
    queryFn: ({ signal }) => getJson<TwitchVideoPage>('/api/twitch/feed?expiring=1&notDownloaded=1&pageSize=12', signal),
  });
  const expiring = expiringQuery.data?.videos ?? [];
  const categories = feed.data?.pages[0]?.categories ?? [];
  const actions = useVideoActions();
  const selection = useVideoSelection(videos, actions);

  // The menu's choices, named so a filtered feed is never mistaken for all of it.
  const menuFilters: ActiveFilter[] = [
    ...(show === 'new' ? [{ id: 'show', label: 'New', onRemove: () => setShow('all') }] : []),
    ...picked('type', type, TYPES, () => setType('')),
    ...picked('status', status, STATUSES, () => setStatus('')),
    ...(streamer ? [{ id: 'streamer', label: subscriptions.find((item) => item.streamer.id === streamer)?.streamer.displayName ?? 'Streamer', onRemove: () => setStreamer('') }] : []),
    ...(category ? [{ id: 'category', label: category, onRemove: () => setCategory('') }] : []),
    ...picked('length', length, LENGTHS, () => setLength('')),
    ...picked('since', since, SINCE, () => setSince('')),
  ];
  const activeFilters = [...menuFilters, ...searchFilter(search, () => setSearch(''))];
  const clearFilters = () => {
    setShow('all');
    setType('');
    setStatus('');
    setStreamer('');
    setCategory('');
    setLength('');
    setSince('');
    setSearch('');
  };
  const filtered = activeFilters.length > 0;

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
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['twitch'] });

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={refresh} disabled={selection.active} />
      <h1 className="sr-only">Twitch</h1>
      <TwitchToolbar
        active="feed"
        actions={(
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={toolbarButtonClass()}
                  aria-label={filterButtonLabel(`Filter: ${menuFilters.map((filter) => filter.label).join(', ') || 'All'}`, menuFilters.length > 0)}
                >
                  <Filter className="h-5 w-5" />
                  <FilterDot active={menuFilters.length > 0} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70dvh] w-56 overflow-y-auto">
                <FilterGroup label="Show" options={SHOW} value={show} onChange={setShow} separated={false} />
                <FilterGroup label="Type" options={TYPES} value={type} onChange={setType} />
                <FilterGroup label="Status" options={STATUSES} value={status} onChange={setStatus} />
                <FilterGroup label="Length" options={LENGTHS} value={length} onChange={setLength} />
                <FilterGroup label="Date" options={SINCE} value={since} onChange={setSince} />
                {subscriptions.length > 1 && (
                  <FilterGroup
                    label="Streamer"
                    options={[{ id: '', label: 'All streamers' }, ...subscriptions.map((item) => ({ id: item.streamer.id, label: item.streamer.displayName }))]}
                    value={streamer}
                    onChange={setStreamer}
                  />
                )}
                {categories.length > 0 && (
                  <FilterGroup
                    label="Category"
                    options={[{ id: '', label: 'All categories' }, ...categories.map((item) => ({ id: item, label: item }))]}
                    value={category}
                    onChange={setCategory}
                  />
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            <ViewSelector
              value={view === 'grid' ? 'posters' : 'overview'}
              modes={['posters', 'overview']}
              onChange={(next) => setView(next === 'posters' ? 'grid' : 'list')}
            />
          </>
        )}
        trailing={(
          <>
            {show === 'new' && (
              <ToolbarButton label="Mark all seen" disabled={markSeen.isPending} onClick={() => markSeen.mutate()}>
                <CheckCheck className="h-5 w-5" />
              </ToolbarButton>
            )}
            {selection.canSelect && (
              <ToolbarButton
                label={selection.active ? 'Exit selection' : 'Select videos'}
                pressed={selection.active}
                filled={selection.active}
                onClick={selection.toggleMode}
              >
                <ListChecks className="h-5 w-5" />
              </ToolbarButton>
            )}
            <ToolbarButton label="Refresh" disabled={feed.isRefetching} onClick={() => void refresh()}>
              <RefreshCw className={`h-5 w-5 ${feed.isRefetching ? 'animate-spin' : ''}`} />
            </ToolbarButton>
            <ToolbarButton label="Add streamer" href="/twitch/streamers/add" filled>
              <Plus className="h-5 w-5" />
            </ToolbarButton>
          </>
        )}
      >
        <SearchBar value={search} onChange={setSearch} placeholder="Search videos..." historyKey="twitch-feed" debounceMs={250} />
      </TwitchToolbar>
      <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} />

      {canManage && !filtered && autoSettings.data?.autoDownloadEnabled === false && (
        <Link href="/settings/twitch" className="press-feedback flex min-h-11 items-center gap-2 rounded-xl bg-card px-3 py-2 text-sm">
          <span className="min-w-0 flex-1 truncate">
            <span className="font-medium">Auto-download is off.</span>{' '}
            <span className="text-muted-foreground">You pick what to save.</span>
          </span>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Link>
      )}

      {live.length > 0 && !filtered && (
        <section aria-label="Live now">
          <h2 className="mb-2 text-base font-semibold">Live now</h2>
          <div className="-mx-2 flex gap-2 overflow-x-auto px-2 pb-1 scrollbar-hide md:-mx-6 md:px-6">
            {live.map(({ streamer: item }) => {
              const avatar = toCachedImageSrc(item.profileImageUrl, undefined, { width: 72 });
              return (
                <Link key={item.id} href={`/twitch/streamers/${item.id}`} className="press-feedback flex max-w-[220px] shrink-0 items-center gap-2 rounded-full bg-card py-1 pl-1 pr-3">
                  <span className="relative block h-8 w-8 shrink-0 overflow-hidden rounded-full bg-muted">
                    {avatar && <FadeInImage src={avatar} alt="" fill sizes="32px" className="object-cover" unoptimized />}
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-medium">{item.displayName}</span>
                    <span className="block truncate text-[10px] text-red-400">{item.liveCategory ?? 'Live'}</span>
                  </span>
                </Link>
              );
            })}
          </div>
        </section>
      )}

      {expiring.length > 0 && !filtered && (
        <section aria-label="Expiring soon">
          <h2 className="mb-2 text-base font-semibold">Expiring soon</h2>
          <div className="-mx-2 flex gap-3 overflow-x-auto px-2 pb-1 scrollbar-hide md:-mx-6 md:px-6">
            {expiring.map((video) => (
              <div key={video.id} className="w-[180px] shrink-0 sm:w-[220px]">
                <TwitchVideoCard video={video} layout="grid" actions={actions} />
              </div>
            ))}
          </div>
        </section>
      )}

      {feed.isLoading ? (
        <TwitchVideoSkeleton />
      ) : feed.isError ? (
        <ErrorState message="Couldn't load the feed" onRetry={() => void feed.refetch()} />
      ) : videos.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          {filtered ? (
            <>
              <p>No videos match your filters.</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>Clear search &amp; filters</Button>
            </>
          ) : subscriptions.length === 0 ? (
            <>
              <p>Subscribe to a streamer to fill your feed.</p>
              <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/twitch/streamers/add">Add streamer</Link></Button>
            </>
          ) : (
            <p>Nothing here yet.</p>
          )}
        </div>
      ) : (
        <section aria-label="Videos">
          {(live.length > 0 || expiring.length > 0) && !filtered && (
            <h2 className="mb-2 text-base font-semibold">All videos</h2>
          )}
          {filtered && <p className="mb-2 px-1 text-xs text-muted-foreground">{total} {total === 1 ? 'video' : 'videos'}</p>}
          <TwitchVideoList
            videos={videos}
            layout={view}
            renderVideo={(video) => (
              <TwitchVideoCard
                video={video}
                layout={view}
                actions={actions}
                selection={selection.selectionFor(video)}
                onSelect={selection.startWith(video)}
              />
            )}
          />
        </section>
      )}

      <div ref={loadMoreRef} aria-hidden className="h-1" />
      {feed.isFetchingNextPage && <p className="py-2 text-center text-sm text-muted-foreground">Loading…</p>}
      {actions.sheet}
      {selection.bar}
    </div>
  );
}
