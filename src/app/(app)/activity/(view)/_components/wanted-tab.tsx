'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from '@/components/ui/app-link';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FloatingActionBar } from '@/components/ui/floating-action-bar';
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import {
  ChevronDown,
  Download,
  ListChecks,
  Loader2,
  Search,
  Tv,
  Film,
  Disc3,
  Scissors,
  ExternalLink,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { useRestorableInfiniteQuery as useInfiniteQuery } from '@/lib/hooks/use-restorable-infinite-query';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import { queryKeys } from '@/lib/query-keys';
import { useCan } from '@/components/permission-provider';
import { cn } from '@/lib/utils';
import { TabErrorState } from './shared';
import {
  isNotReleased,
  searchAllOutcome,
  searchAllRequests,
  searchAllTargets,
  selectedSearchRequests,
  wantedDate,
  wantedRecordKey,
  type SearchRequest,
  type SearchResult,
  type WantedInstance,
  type WantedRecord,
} from './wanted-records';

// --- Wanted Tab ---

const SOURCE_BY_TYPE: Record<string, WantedInstance['source']> = { SONARR: 'sonarr', RADARR: 'radarr', LIDARR: 'lidarr' };

/** Send each command; resolves to whether each was accepted, with its answer. */
async function sendSearchRequests(requests: SearchRequest[]): Promise<Array<SearchResult & { count: number }>> {
  return Promise.all(requests.map(async ({ url, body, count }) => {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => null);
    const data: unknown = res?.ok ? await res.json().catch(() => null) : null;
    return { ok: !!res?.ok, count, data };
  }));
}

/** Send each command; resolves to how many items the accepted and the refused ones covered. */
async function sendSearches(requests: SearchRequest[]): Promise<{ ok: number; fail: number }> {
  const results = await sendSearchRequests(requests);
  return results.reduce(
    (sum, r) => (r.ok ? { ...sum, ok: sum.ok + r.count } : { ...sum, fail: sum.fail + r.count }),
    { ok: 0, fail: 0 },
  );
}

/**
 * Render the Wanted tab showing either missing or cutoff items with per-item, selected and whole-list search, and pagination.
 *
 * @param type - Specifies which set of wanted items to display: `'missing'` or `'cutoff'`.
 * @param filterBy - Selected sources for results (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources, otherwise results are limited to the selected sources.
 * @returns The tab content element that lists records, shows loading and empty states, provides per-record, selected and "Search all" actions, and supports "Load more" pagination.
 */
export function WantedTab({ type, filterBy, instanceFilter }: { type: 'missing' | 'cutoff'; filterBy: string[]; instanceFilter: string }) {
  const PAGE_SIZE = 20;
  const canManageActivity = useCan('activity.manage');
  // Keyed per item: overlapping searches on two items must not clear each
  // other's spinner (a single string flag would).
  const [searching, setSearching] = useState<ReadonlySet<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<ReadonlySet<string>>(new Set());
  const [bulkSearching, setBulkSearching] = useState(false);
  const [confirmSearchAll, setConfirmSearchAll] = useState(false);
  const [showNotReleased, setShowNotReleased] = useState(false);
  const sourcesKey = [...filterBy].sort().join(',') || 'all';

  // A selection belongs to the list it was made on: a filter change drops it, so
  // switching back can't bring hidden picks into "Search selected".
  const listKey = `${sourcesKey}|${instanceFilter}`;
  const [selectionListKey, setSelectionListKey] = useState(listKey);
  if (selectionListKey !== listKey) {
    setSelectionListKey(listKey);
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }

  // The server filters and paginates for exactly this source set + instance, so
  // every filter combination is a genuinely different result — key on all of them
  // and request the page directly. No client-side filtering, no auto-advance.
  const wantedQuery = useInfiniteQuery({
    queryKey: ['activity', 'wanted', type, sourcesKey, instanceFilter],
    queryFn: async ({ pageParam, signal }) => {
      const params = new URLSearchParams({ type, page: String(pageParam), pageSize: String(PAGE_SIZE) });
      if (filterBy.length > 0) params.set('sources', filterBy.join(','));
      if (instanceFilter !== 'all') params.set('instanceId', instanceFilter);
      const res = await fetch(`/api/activity/wanted?${params}`, { signal });
      if (!res.ok) throw new ApiError(res.status, `GET /api/activity/wanted → ${res.status}`);
      return (await res.json()) as { records: WantedRecord[]; totalRecords: number };
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage, allPages) =>
      allPages.length * PAGE_SIZE < (lastPage.totalRecords || 0) ? allPages.length + 1 : undefined,
    // Keep the current results visible while a filter change refetches,
    // instead of blanking to a full-screen spinner.
    placeholderData: keepPreviousData,
  });
  const loading = wantedQuery.isLoading;
  // Pages are slices of a fresh merge each time, so an item added between loads
  // can repeat the previous page's last row: keep its first copy.
  const records = useMemo(() => {
    const seen = new Set<string>();
    return (wantedQuery.data?.pages.flatMap((pg) => pg.records ?? []) ?? []).filter((record) => {
      const key = wantedRecordKey(record);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [wantedQuery.data]);
  const totalRecords = wantedQuery.data?.pages.at(-1)?.totalRecords ?? 0;
  // Films that are not out anywhere yet sit in their own group on Missing,
  // folded away, so the list reads as what is actually out and missing.
  const notReleased = type === 'missing' ? records.filter((r) => isNotReleased(r)) : [];
  const listed = notReleased.length > 0 ? records.filter((r) => !notReleased.includes(r)) : records;
  const selectedRecords = records.filter((r) => selectedKeys.has(wantedRecordKey(r)));

  // Same connection list (and query key) as the page's instance filter.
  const { data: instances = [] } = useQuery({
    queryKey: queryKeys.arrInstances(),
    queryFn: jsonFetcher<Array<{ id: string; label: string; type: string }>>('/api/instances'),
    select: (conns): WantedInstance[] => (Array.isArray(conns) ? conns : []).flatMap((c) =>
      SOURCE_BY_TYPE[c.type] ? [{ id: c.id, source: SOURCE_BY_TYPE[c.type] }] : []),
    staleTime: 5 * 60_000,
    enabled: canManageActivity,
  });
  const searchAllInstances = searchAllTargets(instances, filterBy, instanceFilter);
  const listName = type === 'missing' ? 'missing' : 'cutoff unmet';
  // Helprr searches Radarr's missing films by id, leaving out the "Not released yet" ones.
  const searchAllNote = type === 'missing' && searchAllInstances.some((i) => i.source === 'radarr')
    ? ' Radarr searches only the films that are out: those not released yet are skipped.'
    : '';

  // Surface fetch failures instead of silently rendering "No missing items" (or
  // stale rows under keepPreviousData). Mirrors the toast-on-error the action
  // handlers use; errorUpdatedAt re-fires it once per distinct failure.
  useEffect(() => {
    if (wantedQuery.isError) {
      toast.error('Failed to load wanted items');
    }
  }, [wantedQuery.isError, wantedQuery.errorUpdatedAt]);

  async function handleSearch(record: WantedRecord) {
    const key = wantedRecordKey(record);
    setSearching((prev) => new Set(prev).add(key));
    // Route the search command to the instance the wanted item lives on.
    try {
      const { fail } = await sendSearches(selectedSearchRequests([record]));
      if (fail > 0) toast.error('Search failed');
      else toast.success('Search started');
    } finally {
      setSearching((prev) => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
    }
  }

  function exitSelection() {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }

  function toggleSelected(key: string) {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  async function searchSelected() {
    setBulkSearching(true);
    try {
      const { ok, fail } = await sendSearches(selectedSearchRequests(selectedRecords));
      if (fail === 0) toast.success(ok === 1 ? 'Search started for 1 item' : `Search started for ${ok} items`);
      else toast.error(ok > 0 ? `Search started for ${ok}, but ${fail} failed` : 'Search failed');
      if (ok > 0) exitSelection();
    } finally {
      setBulkSearching(false);
    }
  }

  async function searchAll() {
    setBulkSearching(true);
    try {
      const { tone, message } = searchAllOutcome(listName, await sendSearchRequests(searchAllRequests(type, searchAllInstances)));
      toast[tone](message);
      setConfirmSearchAll(false);
    } finally {
      setBulkSearching(false);
    }
  }

  if (loading) {
    return <ListSkeleton />;
  }

  if (records.length === 0) {
    if (wantedQuery.isError) {
      return <TabErrorState message="Couldn't load wanted items" onRetry={() => wantedQuery.refetch()} />;
    }
    return (
      <div className="text-center py-16 text-muted-foreground">
        {type === 'missing' ? (
          <>
            <Download className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No missing items</p>
          </>
        ) : (
          <>
            <Scissors className="h-8 w-8 mx-auto mb-2 opacity-40" />
            <p className="text-sm">No cutoff unmet items</p>
          </>
        )}
      </div>
    );
  }

  function renderRow(record: WantedRecord) {
    const key = wantedRecordKey(record);
    const isEpisode = record.mediaType === 'episode';
    const isAlbum = record.mediaType === 'album';
    const albumYear = record.releaseDate ? new Date(record.releaseDate).getFullYear() : undefined;
    const displayTitle = isEpisode
      ? `${record.series?.title || 'Unknown'} - S${String(record.seasonNumber ?? 0).padStart(2, '0')}E${String(record.episodeNumber ?? 0).padStart(2, '0')} - ${record.title || 'TBA'}`
      : isAlbum
        ? `${record.artist?.artistName ? `${record.artist.artistName} - ` : ''}${record.title || 'Unknown'}${albumYear ? ` (${albumYear})` : ''}`
        : `${record.title || 'Unknown'} (${record.year || '?'})`;
    const dated = wantedDate(record);
    const icon = isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : isAlbum ? <Disc3 className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />;
    const meta = (
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Badge variant="outline" className="text-[10px] px-1.5 py-0">{record.source}</Badge>
        {dated && (
          <span>{`${dated.label} ${formatDistanceToNow(dated.date, { addSuffix: true })}`}</span>
        )}
      </div>
    );

    if (selectionMode) {
      const selected = selectedKeys.has(key);
      return (
        <button
          key={key}
          type="button"
          onClick={() => toggleSelected(key)}
          aria-pressed={selected}
          className="w-full text-left flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors"
        >
          <Checkbox checked={selected} tabIndex={-1} aria-hidden className="pointer-events-none" />
          <div className="p-1.5 rounded bg-muted">{icon}</div>
          <div className="flex-1 min-w-0">
            <p className="text-sm truncate">{displayTitle}</p>
            {meta}
          </div>
        </button>
      );
    }

    const hasSeriesId = Number.isFinite(record.seriesId);
    const hasSeasonNumber = Number.isFinite(record.seasonNumber);
    const q = record.instanceId ? `?instance=${record.instanceId}` : '';
    const href = isAlbum
      ? `/music/album/${record.id}${q}`
      : isEpisode && hasSeriesId && hasSeasonNumber
        ? `/series/${record.seriesId}/season/${record.seasonNumber}/episode/${record.id}${q}`
        : isEpisode && hasSeriesId
          ? `/series/${record.seriesId}${q}`
          : !isEpisode
            ? `/movies/${record.id}${q}`
            : null;

    return (
      <QuickContextMenu
        key={key}
        label={`Actions for ${displayTitle}`}
        groups={[
          {
            id: 'actions',
            actions: [
              ...(href
                ? [{
                  id: 'open-media',
                  label: 'Open related media',
                  icon: <ExternalLink className="h-4 w-4" />,
                  href,
                }]
                : []),
              ...(canManageActivity
                ? [{
                  id: 'search-release',
                  label: 'Search for release',
                  icon: <Search className="h-4 w-4" />,
                  pending: searching.has(key),
                  onSelect: () => void handleSearch(record),
                }]
                : []),
            ],
          },
        ]}
      >
        <div className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors">
          {href ? (
            <Link href={href} className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors">
              {icon}
            </Link>
          ) : (
            <div className="p-1.5 rounded bg-muted">
              {icon}
            </div>
          )}
          <div className="flex-1 min-w-0">
            {href ? (
              <Link href={href} className="block">
                <p className="text-sm truncate">{displayTitle}</p>
              </Link>
            ) : (
              <p className="text-sm truncate">{displayTitle}</p>
            )}
            {meta}
          </div>
          {canManageActivity && (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 shrink-0"
              onClick={() => handleSearch(record)}
              disabled={searching.has(key)}
              aria-label="Search for release"
            >
              {searching.has(key) ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
          )}
        </div>
      </QuickContextMenu>
    );
  }

  return (
    <div className="space-y-1 animate-list-in">
      {canManageActivity && (
        <div className="flex items-center gap-2 px-3 pt-2 pb-1">
          <span className="flex-1 text-xs text-muted-foreground">
            {totalRecords} {totalRecords === 1 ? 'item' : 'items'}
          </span>
          <Button
            size="sm"
            variant={selectionMode ? 'default' : 'ghost'}
            className="h-8"
            onClick={() => (selectionMode ? exitSelection() : setSelectionMode(true))}
            aria-pressed={selectionMode}
          >
            <ListChecks className="mr-1.5 h-4 w-4" />
            Select
          </Button>
          <Button
            size="sm"
            variant="ghost"
            className="h-8"
            onClick={() => setConfirmSearchAll(true)}
            // While a filter change loads, the count shown is still the old list's.
            disabled={bulkSearching || searchAllInstances.length === 0 || wantedQuery.isPlaceholderData}
          >
            <Search className="mr-1.5 h-4 w-4" />
            Search all
          </Button>
        </div>
      )}
      {listed.map(renderRow)}
      {listed.length === 0 && !wantedQuery.hasNextPage && (
        <p className="px-3 py-4 text-center text-sm text-muted-foreground">Nothing that is out yet is missing.</p>
      )}
      {wantedQuery.hasNextPage && (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => wantedQuery.fetchNextPage()}
          disabled={wantedQuery.isFetchingNextPage}
        >
          {wantedQuery.isFetchingNextPage ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Load more
        </Button>
      )}
      {notReleased.length > 0 && (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => setShowNotReleased((v) => !v)}
            aria-expanded={showNotReleased}
            className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs font-medium text-muted-foreground"
          >
            <ChevronDown className={cn('h-3.5 w-3.5 transition-transform', !showNotReleased && '-rotate-90')} />
            Not released yet ({notReleased.length})
          </button>
          {showNotReleased && (
            <>
              <p className="px-3 pb-1 text-xs text-muted-foreground">Films with no cinema, digital or physical release yet.</p>
              {notReleased.map(renderRow)}
            </>
          )}
        </div>
      )}

      {selectionMode && (
        <FloatingActionBar className="p-2">
          <span className="flex-1 px-2 text-sm text-muted-foreground">{selectedRecords.length} selected</span>
          <Button variant="ghost" className="h-11" onClick={exitSelection}>Cancel</Button>
          <Button
            className="h-11"
            disabled={selectedRecords.length === 0 || bulkSearching}
            onClick={() => void searchSelected()}
          >
            {bulkSearching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Search className="mr-2 h-4 w-4" />}
            Search selected
          </Button>
        </FloatingActionBar>
      )}

      <ConfirmDialog
        open={confirmSearchAll}
        onOpenChange={(open) => { if (!open && !bulkSearching) setConfirmSearchAll(false); }}
        title={`Search for all ${totalRecords} ${listName} ${totalRecords === 1 ? 'item' : 'items'}?`}
        description={`${searchAllInstances.length === 1 ? 'The instance' : `Each of the ${searchAllInstances.length} instances`} this list covers searches your indexers for every monitored item on it. A long list can take a while and use up indexer request limits.${searchAllNote}`}
        confirmLabel="Search all"
        busy={bulkSearching}
        onConfirm={searchAll}
      />
    </div>
  );
}
