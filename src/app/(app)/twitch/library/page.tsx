'use client';

import { useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, ChevronRight, Filter, Loader2, RefreshCw } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { SearchBar } from '@/components/media/search-bar';
import { ActiveFilterBar, FilterDot, filterButtonLabel, searchFilter, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/error-state';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { DeletedRow, FileRow } from '@/components/twitch/file-row';
import type { DeletedFile, LibrarySummary, TwitchFile } from '@/components/twitch/file-types';
import { FilterGroup, type FilterOption } from '@/components/twitch/filter-group';
import { ToolbarButton, toolbarButtonClass, TwitchToolbar } from '@/components/twitch/twitch-toolbar';
import { useFileActions } from '@/components/twitch/use-file-actions';
import { formatBytes } from '@/lib/format';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { cn } from '@/lib/utils';

const PAGE_SIZE = 30;
const DELETED = 'deleted';
const SHOW: FilterOption[] = [
  { id: '', label: 'All videos' },
  { id: 'reencoded', label: 'Re-encoded' },
  { id: 'not-reencoded', label: 'Not re-encoded' },
  { id: 'original-kept', label: 'Original kept' },
  { id: 'keep-forever', label: 'Keep forever' },
  { id: 'not-in-jellyfin', label: 'Not in Jellyfin' },
  { id: DELETED, label: 'Deleted' },
];
const SORTS: FilterOption[] = [
  { id: 'newest', label: 'Newest download' },
  { id: 'oldest', label: 'Oldest download' },
  { id: 'largest', label: 'Largest' },
  { id: 'saved', label: 'Most saved' },
];

interface Page<T> {
  total: number;
  page: number;
  pageSize: number;
  files?: T[];
  deletions?: T[];
}

async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error('Failed to load the library');
  return res.json() as Promise<T>;
}

const nextPage = (last: { page: number; pageSize: number; total: number }) => (
  last.page * last.pageSize < last.total ? last.page + 1 : undefined
);

function StatTile({ value, label, tone, onClick, pressed }: {
  value: string;
  label: string;
  tone?: string;
  onClick: () => void;
  pressed: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={cn('press-feedback min-w-0 rounded-lg bg-card px-2 py-2 text-center', pressed && 'ring-1 ring-primary')}
    >
      <span className={cn('block truncate text-lg font-semibold tabular-nums', tone)}>{value}</span>
      <span className="block truncate text-[10px] text-muted-foreground">{label}</span>
    </button>
  );
}

export default function TwitchLibraryPage() {
  const queryClient = useQueryClient();
  const actions = useFileActions();
  const [filter, setFilter] = useRouteViewState('filter', '');
  const [sort, setSort] = useRouteViewState('sort', 'newest');
  const [streamer, setStreamer] = useRouteViewState('streamer', '');
  const [search, setSearch] = useRouteViewState('search', '');
  const showingDeleted = filter === DELETED;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['twitch'] });

  const params = useMemo(() => {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), sort });
    if (filter && !showingDeleted) query.set('filter', filter);
    if (streamer && !showingDeleted) query.set('streamer', streamer);
    if (search.trim()) query.set('q', search.trim());
    return query.toString();
  }, [filter, showingDeleted, sort, streamer, search]);

  const summary = useQuery({
    queryKey: ['twitch', 'files-summary'],
    queryFn: ({ signal }) => getJson<LibrarySummary>('/api/twitch/files/summary', signal),
  });
  const stats = summary.data;

  const files = useRestorableInfiniteQuery({
    queryKey: ['twitch', 'files', params],
    enabled: !showingDeleted,
    queryFn: ({ pageParam, signal }) => getJson<Page<TwitchFile>>(`/api/twitch/files?${params}&page=${pageParam}`, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    refetchInterval: (query) => (query.state.data?.pages.some((page) => page.files?.some((file) => file.activeJob)) ? 3_000 : false),
    refetchIntervalInBackground: false,
  });
  const rows = useMemo(() => files.data?.pages.flatMap((page) => page.files ?? []) ?? [], [files.data]);

  const history = useRestorableInfiniteQuery({
    queryKey: ['twitch', 'file-history', params],
    enabled: showingDeleted,
    queryFn: ({ pageParam, signal }) => getJson<Page<DeletedFile>>(`/api/twitch/files/history?${params}&page=${pageParam}`, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });
  const deletions = useMemo(() => history.data?.pages.flatMap((page) => page.deletions ?? []) ?? [], [history.data]);

  // The same check as Settings' preview, so the two can never disagree.
  const cleanup = useQuery({
    queryKey: ['twitch', 'retention-preview'],
    queryFn: ({ signal }) => getJson<{ candidates: Array<{ fileId: string }> }>('/api/twitch/retention/preview', signal),
    enabled: actions.canManage,
    staleTime: 5 * 60_000,
  });
  const cleanupDue = useMemo(() => new Set(cleanup.data?.candidates.map((item) => item.fileId)), [cleanup.data]);

  const streamerName = stats?.streamers.find((item) => item.id === streamer)?.displayName;
  const menuFilters: ActiveFilter[] = [
    ...(filter ? [{ id: 'show', label: SHOW.find((item) => item.id === filter)?.label ?? filter, onRemove: () => setFilter('') }] : []),
    ...(streamer && !showingDeleted ? [{ id: 'streamer', label: streamerName ?? 'Streamer', onRemove: () => setStreamer('') }] : []),
  ];
  const activeFilters = [...menuFilters, ...searchFilter(search, () => setSearch(''))];
  const clearFilters = () => {
    setFilter('');
    setStreamer('');
    setSearch('');
  };
  const pickTile = (next: string, nextSort: string) => {
    setFilter(filter === next ? '' : next);
    setSort(filter === next ? 'newest' : nextSort);
  };

  const active = showingDeleted ? history : files;
  const total = active.data?.pages[0]?.total ?? 0;
  const empty = showingDeleted ? deletions.length === 0 : rows.length === 0;

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={refresh} />
      <h1 className="sr-only">Twitch library</h1>
      <TwitchToolbar
        active="library"
        actions={(
          <>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className={toolbarButtonClass()}
                  aria-label={filterButtonLabel(`Filter: ${menuFilters.map((item) => item.label).join(', ') || 'All'}`, menuFilters.length > 0)}
                >
                  <Filter className="h-5 w-5" />
                  <FilterDot active={menuFilters.length > 0} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="max-h-[70dvh] w-56 overflow-y-auto">
                <FilterGroup label="Show" options={SHOW} value={filter} onChange={setFilter} separated={false} />
                {(stats?.streamers.length ?? 0) > 1 && !showingDeleted && (
                  <FilterGroup
                    label="Streamer"
                    options={[
                      { id: '', label: 'All streamers' },
                      ...(stats?.streamers ?? []).map((item) => ({ id: item.id, label: `${item.displayName} (${formatBytes(item.bytes)})` })),
                    ]}
                    value={streamer}
                    onChange={setStreamer}
                  />
                )}
              </DropdownMenuContent>
            </DropdownMenu>
            {!showingDeleted && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button className={toolbarButtonClass()} aria-label={`Sort: ${SORTS.find((item) => item.id === sort)?.label}`}>
                    <ArrowUpDown className="h-5 w-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="w-52">
                  <FilterGroup label="Sort by" options={SORTS} value={sort} onChange={setSort} separated={false} />
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </>
        )}
        trailing={(
          <ToolbarButton label="Refresh" disabled={active.isRefetching} onClick={() => void refresh()}>
            <RefreshCw className={`h-5 w-5 ${active.isRefetching ? 'animate-spin' : ''}`} />
          </ToolbarButton>
        )}
      >
        <SearchBar value={search} onChange={setSearch} placeholder="Search..." historyKey="twitch-library" debounceMs={250} />
      </TwitchToolbar>

      {stats && (
        <section aria-label="Storage" className="grid grid-cols-3 gap-2">
          <StatTile value={formatBytes(stats.totalBytes)} label={`${stats.count} ${stats.count === 1 ? 'video' : 'videos'}`} pressed={false} onClick={clearFilters} />
          <StatTile
            value={formatBytes(stats.savedBytes)}
            label="Saved by re-encoding"
            tone={stats.savedBytes > 0 ? 'text-emerald-500' : 'text-muted-foreground'}
            pressed={filter === 'reencoded'}
            onClick={() => pickTile('reencoded', 'saved')}
          />
          <StatTile
            value={formatBytes(stats.originalsBytes)}
            label={`${stats.originalsKept} ${stats.originalsKept === 1 ? 'original' : 'originals'} kept`}
            tone={stats.originalsKept > 0 ? 'text-amber-500' : 'text-muted-foreground'}
            pressed={filter === 'original-kept'}
            onClick={() => pickTile('original-kept', 'largest')}
          />
        </section>
      )}

      {(stats?.reencodeWaiting || cleanupDue.size > 0) ? (
        <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
          {Boolean(stats?.reencodeWaiting) && (
            <Link href="/twitch/queue" className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm active:bg-foreground/5">
              <span className="min-w-0 flex-1 truncate">
                {stats?.reencodeWaiting} {stats?.reencodeWaiting === 1 ? 'video' : 'videos'} waiting to re-encode
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          )}
          {cleanupDue.size > 0 && (
            <Link href="/settings/twitch" className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm active:bg-foreground/5">
              <span className="min-w-0 flex-1 truncate">
                {cleanupDue.size} {cleanupDue.size === 1 ? 'video is' : 'videos are'} past your cleanup rules
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          )}
        </div>
      ) : null}

      <ActiveFilterBar filters={activeFilters} onClearAll={clearFilters} />

      {active.isLoading ? (
        <ListSkeleton count={6} />
      ) : active.isError ? (
        <ErrorState message="Couldn't load the library" onRetry={() => void active.refetch()} />
      ) : empty ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          {activeFilters.length > 0 ? (
            <>
              <p>{showingDeleted && activeFilters.length === 1 ? 'Nothing has been deleted since this was added.' : 'No videos match your filters.'}</p>
              <Button variant="outline" size="sm" className="mt-3" onClick={clearFilters}>Clear search &amp; filters</Button>
            </>
          ) : (
            <>
              <p>No videos saved yet.</p>
              <Button asChild variant="outline" size="sm" className="mt-3"><Link href="/twitch">Go to the feed</Link></Button>
            </>
          )}
        </div>
      ) : (
        <section aria-label={showingDeleted ? 'Deleted videos' : 'Saved videos'}>
          <p className="px-1 pb-2 text-xs text-muted-foreground">
            {total} {total === 1 ? 'video' : 'videos'}
            {showingDeleted
              ? ` · ${formatBytes(stats?.freedBytes ?? 0)} freed in total`
              : stats?.diskFreeBytes != null ? ` · ${formatBytes(stats.diskFreeBytes)} free on the disk` : ''}
          </p>
          <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
            {showingDeleted
              ? deletions.map((row) => <DeletedRow key={row.id} row={row} />)
              : rows.map((file) => <FileRow key={file.id} file={file} actions={actions} cleanupDue={cleanupDue.has(file.id)} />)}
          </div>
        </section>
      )}

      {active.hasNextPage && (
        <Button variant="ghost" className="w-full" disabled={active.isFetchingNextPage} onClick={() => void active.fetchNextPage()}>
          {active.isFetchingNextPage && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
          Load more
        </Button>
      )}
      {actions.dialogs}
    </div>
  );
}
