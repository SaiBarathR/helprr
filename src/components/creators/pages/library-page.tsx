'use client';

import { useCreatorPlatform } from '@/components/creators/platform';
import { useEffect, useMemo, useRef } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowUpDown, ChevronRight, Filter, Loader2, RefreshCw } from 'lucide-react';
import Link from '@/components/ui/app-link';
import { SearchBar } from '@/components/media/search-bar';
import { ViewSelector } from '@/components/media/view-selector';
import { ActiveFilterBar, FilterDot, filterButtonLabel, searchFilter, type ActiveFilter } from '@/components/ui/active-filter-bar';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { ErrorState } from '@/components/ui/error-state';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { FileGroups } from '@/components/creators/file-groups';
import { DeletedRow, FileRow } from '@/components/creators/file-row';
import type { DeletedFile, FileGroupPage, LibrarySummary, ArchiveFile } from '@/components/creators/file-types';
import { FilterGroup, type FilterOption } from '@/components/creators/filter-group';
import { ToolbarButton, toolbarButtonClass, CreatorToolbar } from '@/components/creators/toolbar';
import { useFileActions } from '@/components/creators/use-file-actions';
import { useLibraryView } from '@/components/creators/use-feed-view';
import { formatBytes } from '@/lib/format';
import { useRestorableInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { useRouteViewState } from '@/lib/hooks/use-route-view-state';
import { cn } from '@/lib/utils';
import { PageTitle } from '@/components/layout/page-title';

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

export function CreatorLibraryPage() {
  const platform = useCreatorPlatform();
  const queryClient = useQueryClient();
  const actions = useFileActions();
  const [filter, setFilter] = useRouteViewState('filter', '');
  const [sort, setSort] = useRouteViewState('sort', 'newest');
  const [streamer, setStreamer] = useRouteViewState('streamer', '');
  const [search, setSearch] = useRouteViewState('search', '');
  const showingDeleted = filter === DELETED;
  const [view, setView] = useLibraryView();
  // One channel is already a group, and deleted videos have no files left to group.
  const grouped = view === 'grouped' && !showingDeleted && !streamer;
  const refresh = () => queryClient.invalidateQueries({ queryKey: [platform.id] });

  const params = useMemo(() => {
    const query = new URLSearchParams({ pageSize: String(PAGE_SIZE), sort });
    if (filter && !showingDeleted) query.set('filter', filter);
    if (streamer && !showingDeleted) query.set('streamer', streamer);
    if (search.trim()) query.set('q', search.trim());
    return query.toString();
  }, [filter, showingDeleted, sort, streamer, search]);

  const summary = useQuery({
    queryKey: [platform.id, 'files-summary'],
    queryFn: ({ signal }) => getJson<LibrarySummary>(`${platform.api}/files/summary`, signal),
  });
  const stats = summary.data;
  // YouTube files are rarely re-encoded, so these only show once there is something in them.
  const showReencode = platform.id === 'twitch' || Boolean(stats && (stats.savedBytes > 0 || stats.originalsKept > 0));

  const files = useRestorableInfiniteQuery({
    queryKey: [platform.id, 'files', params],
    enabled: !showingDeleted && !grouped,
    queryFn: ({ pageParam, signal }) => getJson<Page<ArchiveFile>>(`${platform.api}/files?${params}&page=${pageParam}`, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    refetchInterval: (query) => (query.state.data?.pages.some((page) => page.files?.some((file) => file.activeJob)) ? 3_000 : false),
    refetchIntervalInBackground: false,
  });
  const rows = useMemo(() => files.data?.pages.flatMap((page) => page.files ?? []) ?? [], [files.data]);
  // Under 'files' too, so keep forever and refreshes reach it the same way.
  const groupsQuery = useRestorableInfiniteQuery({
    queryKey: [platform.id, 'files', 'groups', params],
    enabled: grouped,
    queryFn: ({ pageParam, signal }) => getJson<FileGroupPage>(`${platform.api}/files/groups?${params}&page=${pageParam}`, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
    refetchInterval: (query) => (
      query.state.data?.pages.some((page) => page.groups.some((group) => group.files.some((file) => file.activeJob))) ? 3_000 : false
    ),
    refetchIntervalInBackground: false,
  });
  const groups = useMemo(() => groupsQuery.data?.pages.flatMap((page) => page.groups) ?? [], [groupsQuery.data]);
  const shown = useMemo(() => (grouped ? groups.flatMap((group) => group.files) : rows), [grouped, groups, rows]);

  // Only the rows poll, so the totals follow them through and catch the last job's result.
  const working = shown.some((file) => file.activeJob);
  const wasWorking = useRef(false);
  useEffect(() => {
    if (wasWorking.current || working) void queryClient.invalidateQueries({ queryKey: [platform.id, 'files-summary'] });
    wasWorking.current = working;
  }, [working, shown, queryClient, platform.id]);

  const history = useRestorableInfiniteQuery({
    queryKey: [platform.id, 'file-history', params],
    enabled: showingDeleted,
    queryFn: ({ pageParam, signal }) => getJson<Page<DeletedFile>>(`${platform.api}/files/history?${params}&page=${pageParam}`, signal),
    initialPageParam: 1,
    getNextPageParam: nextPage,
  });
  const deletions = useMemo(() => history.data?.pages.flatMap((page) => page.deletions ?? []) ?? [], [history.data]);

  // The same check as Settings' preview, so the two can never disagree.
  const cleanup = useQuery({
    queryKey: [platform.id, 'retention-preview'],
    queryFn: ({ signal }) => getJson<{ candidates: Array<{ fileId: string }> }>(`${platform.api}/retention/preview`, signal),
    enabled: actions.canManage && platform.id === 'twitch',
    staleTime: 5 * 60_000,
  });
  const cleanupDue = useMemo(() => new Set(cleanup.data?.candidates.map((item) => item.fileId)), [cleanup.data]);

  const streamerName = stats?.streamers.find((item) => item.id === streamer)?.displayName;
  const menuFilters: ActiveFilter[] = [
    ...(filter ? [{ id: 'show', label: SHOW.find((item) => item.id === filter)?.label ?? filter, onRemove: () => setFilter('') }] : []),
    ...(streamer && !showingDeleted ? [{ id: 'streamer', label: streamerName ?? platform.creatorLabel, onRemove: () => setStreamer('') }] : []),
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

  const active = showingDeleted ? history : grouped ? groupsQuery : files;
  const total = (grouped ? groupsQuery.data?.pages[0]?.videoTotal : (showingDeleted ? history : files).data?.pages[0]?.total) ?? 0;
  const empty = showingDeleted ? deletions.length === 0 : shown.length === 0;

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={refresh} />
      <PageTitle>{platform.name} library</PageTitle>
      <CreatorToolbar
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
                    label={platform.creatorLabel}
                    options={[
                      { id: '', label: `All ${platform.creatorsLabel.toLowerCase()}` },
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
            {!showingDeleted && (
              <ViewSelector
                value={view === 'grouped' ? 'grouped' : 'overview'}
                modes={['grouped', 'overview']}
                onChange={(next) => setView(next === 'grouped' ? 'grouped' : 'list')}
              />
            )}
          </>
        )}
        trailing={(
          <ToolbarButton label="Refresh" disabled={active.isRefetching} onClick={() => void refresh()}>
            <RefreshCw className={`h-5 w-5 ${active.isRefetching ? 'animate-spin' : ''}`} />
          </ToolbarButton>
        )}
      >
        <SearchBar value={search} onChange={setSearch} placeholder="Search..." historyKey={`${platform.id}-library`} debounceMs={250} />
      </CreatorToolbar>

      {stats && (
        <section aria-label="Storage" className={showReencode ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-1 gap-2'}>
          <StatTile value={formatBytes(stats.totalBytes)} label={`${stats.count} ${stats.count === 1 ? 'video' : 'videos'}`} pressed={false} onClick={clearFilters} />
          {showReencode && (
            <>
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
            </>
          )}
        </section>
      )}

      {(stats?.reencodeWaiting || cleanupDue.size > 0) ? (
        <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
          {Boolean(stats?.reencodeWaiting) && (
            <Link href={`${platform.base}/queue`} className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm active:bg-foreground/5">
              <span className="min-w-0 flex-1 truncate">
                {stats?.reencodeWaiting} {stats?.reencodeWaiting === 1 ? 'video' : 'videos'} waiting to re-encode
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Link>
          )}
          {cleanupDue.size > 0 && (
            <Link href={`/settings/${platform.id}`} className="flex min-h-11 items-center gap-2 px-3 py-2 text-sm active:bg-foreground/5">
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
              <Button asChild variant="outline" size="sm" className="mt-3"><Link href={platform.base}>Go to the feed</Link></Button>
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
          {grouped ? (
            <FileGroups groups={groups} params={params} actions={actions} cleanupDue={cleanupDue} />
          ) : (
            <div className="divide-y divide-border/50 overflow-hidden rounded-xl bg-card">
              {showingDeleted
                ? deletions.map((row) => <DeletedRow key={row.id} row={row} />)
                : rows.map((file) => <FileRow key={file.id} file={file} actions={actions} cleanupDue={cleanupDue.has(file.id)} />)}
            </div>
          )}
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
