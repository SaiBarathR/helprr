'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { PageSpinner } from '@/components/ui/page-spinner';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Download, Trash2, AlertTriangle,
  Upload, Loader2, RefreshCw, FileWarning, Search, Tv, Film, Disc3, Scissors,
  Clock, Filter, ArrowUpDown, ChevronRight, Layers,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { QueueItem } from '@/types';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher, backoffRefetchInterval } from '@/lib/query-fetch';
import { invalidateActivity } from '@/lib/query-invalidation';
import { classifyQueueIssue } from '@/lib/queue-state';
import { useUIStore } from '@/lib/store';
import { type InstanceOption } from '@/components/instance-filter';
import { useCan } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';

// --- Status helpers ---

function statusColor(status: string, tracked?: string) {
  if (tracked === 'warning' || status === 'warning') return 'bg-orange-500/10 text-orange-500 border-orange-500/20';
  if (tracked === 'error' || status === 'failed') return 'bg-red-500/10 text-red-500 border-red-500/20';
  if (status === 'completed' || status === 'imported') return 'bg-green-500/10 text-green-500 border-green-500/20';
  if (status === 'downloading') return 'bg-blue-500/10 text-blue-500 border-blue-500/20';
  if (status === 'queued' || status === 'delay') return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20';
  return 'bg-muted text-muted-foreground border-muted';
}

function statusLabel(item: QueueItem & { source?: string }) {
  const issue = classifyQueueIssue(item.trackedDownloadState, item.trackedDownloadStatus);
  if (issue === 'import') return 'MANUAL IMPORT';
  if (issue === 'download') return 'DOWNLOAD FAILED';
  // Download-client status wins over the tracked state: a paused/queued item can
  // still report trackedDownloadState 'downloading' upstream.
  if (item.status === 'paused') return 'PAUSED';
  if (item.status === 'queued') return 'QUEUED';
  if (item.status === 'delay') return 'DELAYED';
  if (item.trackedDownloadState === 'importing') return 'IMPORTING';
  if (item.trackedDownloadState === 'importPending') return 'IMPORT PENDING';
  if (item.trackedDownloadState === 'downloading') return 'DOWNLOADING';
  if (item.status === 'completed') return 'COMPLETED';
  return (item.trackedDownloadState || item.status || 'UNKNOWN').toUpperCase();
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function getQueueItemQuality(item: QueueItem): string | undefined {
  return item.quality?.quality?.name || item.movie?.movieFile?.quality?.quality?.name;
}

function getQueueCustomFormats(item: QueueItem): string | undefined {
  const names = item.customFormats?.map((format) => format.name).filter(Boolean);
  return names && names.length > 0 ? names.join(', ') : undefined;
}

function getQueueMediaHref(item: QueueItem & { source?: string }): string | null {
  const q = item.instanceId ? `?instance=${item.instanceId}` : '';
  const seriesId = item.seriesId ?? item.series?.id;
  const seasonNumber = item.seasonNumber ?? item.episode?.seasonNumber;
  const episodeId = item.episodeId ?? item.episode?.id;
  if (seriesId && seasonNumber && episodeId) {
    return `/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}${q}`;
  }
  if (seriesId && seasonNumber) {
    return `/series/${seriesId}/season/${seasonNumber}${q}`;
  }
  if (seriesId) {
    return `/series/${seriesId}${q}`;
  }
  const movieId = item.movieId ?? item.movie?.id;
  if (movieId) {
    return `/movies/${movieId}${q}`;
  }
  const albumId = item.albumId ?? item.album?.id;
  if (albumId) {
    return `/music/album/${albumId}${q}`;
  }
  const artistId = item.artistId ?? item.artist?.id;
  if (artistId) {
    return `/music/${artistId}${q}`;
  }
  return null;
}

// --- Season-pack grouping ---

type QueueRecord = QueueItem & { source?: string };

interface QueueGroup {
  key: string;
  items: QueueRecord[];
  rep: QueueRecord; // representative record: every record shares the torrent's size/status/progress
  isPack: boolean; // more than one tracked item in the same download (e.g. a season pack)
}

/**
 * Group queue records that belong to the same physical download. Sonarr returns
 * one queue record per episode for a season-pack torrent, all sharing the same
 * `downloadId`; collapsing them into a single group keeps the list readable.
 * Records without a downloadId, and single-item downloads, stay on their own.
 * Insertion order is preserved so the caller can sort groups by their rep.
 */
function groupQueueByDownload(items: QueueRecord[]): QueueGroup[] {
  const groups = new Map<string, QueueRecord[]>();
  const order: string[] = [];
  for (const item of items) {
    const key = item.downloadId
      ? `dl-${item.source}-${item.instanceId ?? ''}-${item.downloadId}`
      : `solo-${item.source}-${item.id}`;
    let bucket = groups.get(key);
    if (!bucket) {
      bucket = [];
      groups.set(key, bucket);
      order.push(key);
    }
    bucket.push(item);
  }
  return order.map((key) => {
    const bucket = groups.get(key)!;
    return { key, items: bucket, rep: bucket[0], isPack: bucket.length > 1 };
  });
}

/** Short SxxExx label for a queue record, falling back to the bare episode number. */
function episodeLabel(item: QueueRecord): string {
  const season = item.episode?.seasonNumber ?? item.seasonNumber;
  const number = item.episode?.episodeNumber ?? item.episodeNumber;
  if (season != null && number != null) {
    return `S${String(season).padStart(2, '0')}E${String(number).padStart(2, '0')}`;
  }
  if (number != null) return `E${String(number).padStart(2, '0')}`;
  return '';
}

// --- Tabs definition ---

type TabKey = 'queue' | 'failed' | 'missing' | 'cutoff';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'queue', label: 'Queue' },
  { key: 'failed', label: 'Failed' },
  { key: 'missing', label: 'Missing' },
  { key: 'cutoff', label: 'Cutoff' },
];

function isTabKey(value: string): value is TabKey {
  return TABS.some((t) => t.key === value);
}

// --- Sort options ---

type SortKey = 'title' | 'progress' | 'timeleft' | 'size';

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'title', label: 'Title' },
  { key: 'progress', label: 'Progress' },
  { key: 'timeleft', label: 'Time Left' },
  { key: 'size', label: 'Size' },
];

const SORT_OPTIONS_BY_TAB: Record<TabKey, { key: SortKey; label: string }[]> = {
  queue: SORT_OPTIONS,
  failed: [],
  missing: [],
  cutoff: [],
};

function isSortKey(value: string): value is SortKey {
  return SORT_OPTIONS.some((option) => option.key === value);
}

// --- Filter options ---

type FilterKey = 'all' | 'sonarr' | 'radarr' | 'lidarr';

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sonarr', label: 'Sonarr' },
  { key: 'radarr', label: 'Radarr' },
  { key: 'lidarr', label: 'Lidarr' },
];

function isFilterKey(value: string): value is FilterKey {
  return FILTER_OPTIONS.some((option) => option.key === value);
}

/**
 * Renders the Activity page with header controls (filter, sort, history, refresh) and tabbed views for Queue, Failed imports, Missing, and Cutoff items.
 *
 * The component manages local UI state for the active tab, refresh state, sort and filter selection, and queue count. It triggers background refresh commands for Sonarr and Radarr, navigates to history and import routes, and passes sorting/filtering props to the tab panels.
 *
 * @returns The Activity page React element
 */

export default function ActivityPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const setActivityTab = useUIStore((s) => s.setActivityTab);
  const sortBy = useUIStore((s) => s.activitySortBy);
  const setSortBy = useUIStore((s) => s.setActivitySortBy);
  const filterBy = useUIStore((s) => s.activityFilterBy);
  const setFilterBy = useUIStore((s) => s.setActivityFilterBy);
  const instanceFilter = useUIStore((s) => s.activityInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setActivityInstanceFilter);
  const searchParamsKey = searchParams.toString();
  // Tab priority: an explicit ?tab (a widget or push-notification deep-link) wins
  // and is applied here on the first paint; otherwise we resume the last-used tab
  // from the persisted store in the effect below (the nav item / a generic "view
  // all"). The initializer can't read the persisted store — it hydrates after the
  // first render, and reading it during render would break SSR hydration — so the
  // default here is 'queue' and the resume happens post-hydration. Local state
  // drives the render so in-page taps switch instantly.
  const [tab, setTab] = useState<TabKey>(() => {
    const t = searchParams.get('tab');
    return t && isTabKey(t) ? t : 'queue';
  });
  const [refreshing, setRefreshing] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const queryClient = useQueryClient();
  // arr instances for the per-instance filter (shown only when >1 instance).
  const { data: instanceOptions = [] } = useQuery({
    // Distinct from queryKeys.instances() (['instances','all'] → /api/services); this
    // is the /api/instances connection list for the filter. Keep it from prefix-
    // overlapping the services key so the two can't cross-invalidate.
    queryKey: ['arr-instances'],
    queryFn: jsonFetcher<Array<{ id: string; label: string }>>('/api/instances'),
    select: (conns): InstanceOption[] =>
      Array.isArray(conns) ? conns.map((c) => ({ id: c.id, label: c.label })) : [],
    staleTime: 5 * 60_000,
  });

  // Drop a stale instance selection if that instance no longer exists.
  useEffect(() => {
    if (instanceFilter !== 'all' && instanceOptions.length > 0 && !instanceOptions.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instanceOptions, instanceFilter, setInstanceFilter]);
  const initRef = useRef(false);
  // Set when the user taps a tab in-page, so a late hydration resume can't override it.
  const userSwitchedTabRef = useRef(false);
  const availableSortOptions = SORT_OPTIONS_BY_TAB[tab];

  useEffect(() => {
    if (!hasHydrated || initRef.current) return;
    initRef.current = true;
    const params = new URLSearchParams(searchParamsKey);
    const currentState = useUIStore.getState();
    // Resume the last-used tab when arriving without an explicit ?tab deep-link
    // (the nav item / a generic "view all"). A ?tab from a widget or push wins and
    // was already applied by the useState initializer above.
    if (!params.get('tab') && !userSwitchedTabRef.current && isTabKey(currentState.activityTab)) {
      setTab(currentState.activityTab);
    }
    const requestedSource = params.get('source');
    const requestedSort = params.get('sort');
    if (requestedSource && isFilterKey(requestedSource) && requestedSource !== 'all') {
      setFilterBy([requestedSource]);
    }
    if (requestedSort && isSortKey(requestedSort) && requestedSort !== currentState.activitySortBy) {
      setSortBy(requestedSort);
    }
  }, [hasHydrated, searchParamsKey, setFilterBy, setSortBy]);

  function handleTabChange(nextTab: TabKey) {
    if (!isTabKey(nextTab)) return;
    setTab(nextTab); // local state is the render source → the tab switches instantly
    userSwitchedTabRef.current = true; // don't let a late hydration resume override this
    setActivityTab(nextTab); // persist as the last-used tab (resumed on a no-?tab entry)

    // Mirror the tab into the URL for deep-linking, but via history.replaceState so
    // there's no router navigation / RSC round-trip to delay the switch.
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextTab);
    const query = params.toString();
    window.history.replaceState(null, '', query ? `/activity?${query}` : '/activity');
  }

  /**
   * Trigger a refresh of monitored downloads in Sonarr and Radarr and notify the user of the outcome.
   *
   * While running, the component's refreshing state is set to true; it resets to false when finished.
   * On success (when the requests complete or settle) a success toast is shown; on error a failure toast is shown.
   */
  async function handleRefreshActivity() {
    setRefreshing(true);
    try {
      const body = JSON.stringify({ name: 'RefreshMonitoredDownloads' });
      const headers = { 'Content-Type': 'application/json' };
      const results = await Promise.allSettled([
        fetch('/api/sonarr/command', { method: 'POST', headers, body }),
        fetch('/api/radarr/command', { method: 'POST', headers, body }),
        fetch('/api/lidarr/command', { method: 'POST', headers, body }),
      ]);
      const anyOk = results.some((r) => r.status === 'fulfilled' && r.value.ok);
      if (anyOk) {
        // Pull the current queue/history/wanted now (the command keeps updating
        // server-side; the normal poll reconciles anything that lands later).
        invalidateActivity(queryClient);
        toast.success('Activity refresh triggered');
      } else {
        toast.error('Failed to refresh activity');
      }
    } catch {
      toast.error('Failed to refresh activity');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col min-h-0 animate-content-in">
      <div className="sticky z-30 flex items-center bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80" style={{ top: 'var(--header-height, 0px)' }}>
        {/* Top bar */}
        <div className="flex items-center justify-between pt-2 pb-2 w-full">
          <div className="flex items-center gap-1">
            {/* Filter */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-8 w-8">
                  <Filter className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuCheckboxItem
                  checked={filterBy.length === 0}
                  onCheckedChange={() => setFilterBy([])}
                  onSelect={(e) => e.preventDefault()}
                >
                  All
                </DropdownMenuCheckboxItem>
                {FILTER_OPTIONS.filter((opt) => opt.key !== 'all').map((opt) => (
                  <DropdownMenuCheckboxItem
                    key={opt.key}
                    checked={filterBy.includes(opt.key)}
                    onCheckedChange={() => setFilterBy(
                      filterBy.includes(opt.key)
                        ? filterBy.filter((s) => s !== opt.key)
                        : [...filterBy, opt.key]
                    )}
                    onSelect={(e) => e.preventDefault()}
                  >
                    {opt.label}
                  </DropdownMenuCheckboxItem>
                ))}
                {/* Instance sub-filter, folded into this same dropdown to save mobile width. */}
                {instanceOptions.length > 1 && (
                  <>
                    <DropdownMenuSeparator />
                    <DropdownMenuLabel>Instance</DropdownMenuLabel>
                    <DropdownMenuCheckboxItem
                      checked={instanceFilter === 'all'}
                      onCheckedChange={() => setInstanceFilter('all')}
                      onSelect={(e) => e.preventDefault()}
                    >
                      All instances
                    </DropdownMenuCheckboxItem>
                    {instanceOptions.map((inst) => (
                      <DropdownMenuCheckboxItem
                        key={inst.id}
                        checked={instanceFilter === inst.id}
                        onCheckedChange={() => setInstanceFilter(inst.id)}
                        onSelect={(e) => e.preventDefault()}
                      >
                        {inst.label}
                      </DropdownMenuCheckboxItem>
                    ))}
                  </>
                )}
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Sort */}
            {availableSortOptions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon" className="h-8 w-8">
                    <ArrowUpDown className="h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {availableSortOptions.map((opt) => (
                    <DropdownMenuItem
                      key={opt.key}
                      onClick={() => setSortBy(opt.key)}
                      className={sortBy === opt.key ? 'bg-accent' : ''}
                    >
                      {opt.label}
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {/* History */}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8"
              onClick={() => router.push('/activity/history')}
            >
              <Clock className="h-4 w-4" />
            </Button>

            {/* Refresh */}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8"
                  onClick={handleRefreshActivity}
                  disabled={refreshing}
                >
                  {refreshing ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <RefreshCw className="h-4 w-4" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </div>
        </div>

        {/* Segmented control tabs */}
        <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => handleTabChange(t.key)}
              className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${tab === t.key
                ? 'bg-background text-foreground shadow-sm'
                : 'text-muted-foreground hover:text-foreground'
                }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Queue count */}
      {tab === 'queue' && queueCount > 0 && (
        <p className="text-xs text-muted-foreground mb-1">
          {queueCount} {queueCount === 1 ? 'Task' : 'Tasks'}
        </p>
      )}

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'queue' && (
          <QueueTab
            sortBy={sortBy}
            filterBy={filterBy}
            instanceFilter={instanceFilter}
            onCountChange={setQueueCount}
          />
        )}
        {tab === 'failed' && <FailedImportsTab filterBy={filterBy} instanceFilter={instanceFilter} />}
        {tab === 'missing' && <WantedTab type="missing" filterBy={filterBy} instanceFilter={instanceFilter} />}
        {tab === 'cutoff' && <WantedTab type="cutoff" filterBy={filterBy} instanceFilter={instanceFilter} />}
      </div>
    </div>
  );
}

/**
 * Renders the Queue tab UI for activity, showing current download/import queue items.
 *
 * Polls the server for queue records at a configurable interval, applies the provided filter and sort,
 * reports the visible item count via `onCountChange`, and exposes per-item details and removal from the queue.
 *
 * @param sortBy - Key used to sort visible queue items (title, progress, timeleft, or size)
 * @param filterBy - Selected sources to limit items to (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources.
 * @param onCountChange - Callback invoked with the current number of visible items after filtering and sorting
 * @returns The rendered Queue tab content as a JSX element
 */

function QueueTab({
  sortBy,
  filterBy,
  instanceFilter,
  onCountChange,
}: {
  sortBy: SortKey;
  filterBy: string[];
  instanceFilter: string;
  onCountChange: (count: number) => void;
}) {
  const canManageActivity = useCan('activity.manage');
  const { adjustBadge } = useBadgeActions();
  const queryClient = useQueryClient();
  const [selectedItem, setSelectedItem] = useState<(QueueItem & { source?: string }) | null>(null);
  const [removing, setRemoving] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  // Season-pack groups start collapsed; keyed by group key (stable across polls
  // since it derives from the download id), so an open group stays open on refetch.
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set());
  const toggleExpand = (key: string) =>
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  useEffect(() => {
    // Load the configured activity refresh interval (ms); falls back to 5s.
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('activityRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  // Poll the queue: pause when the tab is hidden, refetch on return, back off on
  // failure — same behavior the old useVisibleInterval provided.
  const queueQuery = useQuery({
    queryKey: ['activity', 'queue'],
    queryFn: jsonFetcher<{ records?: (QueueItem & { source?: string })[] }>('/api/activity/queue'),
    select: (d) => d.records ?? [],
    refetchInterval: backoffRefetchInterval(refreshIntervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const queue = queueQuery.data ?? [];
  const loading = queueQuery.isLoading;

  // Apply filter
  const filtered = queue.filter((item) =>
    (filterBy.length === 0 || (item.source !== undefined && filterBy.includes(item.source)))
    && (instanceFilter === 'all' || item.instanceId === instanceFilter)
  );

  // Collapse multi-episode downloads (season packs) into one entry, then sort the
  // groups by their representative record so a pack sorts as a single task.
  const groups = groupQueueByDownload(filtered);
  const sorted = [...groups].sort((a, b) => {
    const ra = a.rep;
    const rb = b.rep;
    switch (sortBy) {
      case 'title':
        return (ra.title || '').localeCompare(rb.title || '');
      case 'progress': {
        const pA = ra.size > 0 ? (ra.size - ra.sizeleft) / ra.size : 0;
        const pB = rb.size > 0 ? (rb.size - rb.sizeleft) / rb.size : 0;
        return pB - pA;
      }
      case 'timeleft':
        return (ra.timeleft || 'zz').localeCompare(rb.timeleft || 'zz');
      case 'size':
        return rb.size - ra.size;
      default:
        return 0;
    }
  });

  useEffect(() => {
    onCountChange(sorted.length);
  }, [sorted.length, onCountChange]);

  async function handleRemove(id: number, source: string, instanceId?: string) {
    setRemoving(true);
    // The removed item leaves the queue (total -1) and, if it was in a
    // failed/import-blocked state, the attention count too.
    const wasAttention = selectedItem
      ? classifyQueueIssue(selectedItem.trackedDownloadState, selectedItem.trackedDownloadStatus) !== null
      : false;
    try {
      const instanceQs = instanceId ? `&instanceId=${instanceId}` : '';
      const res = await fetch(`/api/activity/queue/${id}?source=${source}&removeFromClient=true&blocklist=false${instanceQs}`, { method: 'DELETE' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Failed to remove');
      }
      toast.success('Removed from queue');
      adjustBadge('activity', -1, wasAttention ? -1 : 0);
      setSelectedItem(null);
      void invalidateActivity(queryClient);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to remove'); }
    finally { setRemoving(false); }
  }

  if (loading) {
    return <PageSpinner />;
  }

  if (sorted.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <Download className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No items in queue</p>
      </div>
    );
  }

  return (
    <>
      <div className="space-y-2 animate-list-in">
        {sorted.map((group) => {
          const { rep } = group;
          const progress = rep.size > 0 ? ((rep.size - rep.sizeleft) / rep.size) * 100 : 0;
          const qualityName = getQueueItemQuality(rep);

          // Single-item download → the existing card, opening the detail drawer.
          if (!group.isPack) {
            return (
              <button
                key={group.key}
                onClick={() => setSelectedItem(rep)}
                className="w-full text-left rounded-xl bg-muted/30 p-3 space-y-2 active:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{rep.title}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 ${statusColor(rep.status, rep.trackedDownloadStatus)}`}
                      >
                        {statusLabel(rep)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {rep.source}
                      </Badge>
                      {qualityName && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {qualityName}
                        </Badge>
                      )}
                      {typeof rep.customFormatScore === 'number' && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          CF {rep.customFormatScore}
                        </Badge>
                      )}
                      {rep.indexer && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {rep.indexer}
                        </Badge>
                      )}
                    </div>
                  </div>
                  {rep.timeleft && (
                    <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                      {rep.timeleft}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={progress} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {progress.toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Left: {formatBytes(rep.sizeleft)}</span>
                  <span>Total: {formatBytes(rep.size)}</span>
                </div>
              </button>
            );
          }

          // Season pack → one collapsible card; tapping the header toggles the
          // per-episode list, each row opening that episode's detail drawer.
          const open = expandedKeys.has(group.key);
          const season = rep.seasonNumber ?? rep.episode?.seasonNumber;
          const packTitle = rep.series?.title
            ? `${rep.series.title}${season != null ? ` · Season ${season}` : ''}`
            : rep.title;
          const episodes = [...group.items].sort(
            (a, b) =>
              (a.episode?.episodeNumber ?? a.episodeNumber ?? 0) -
              (b.episode?.episodeNumber ?? b.episodeNumber ?? 0)
          );

          return (
            <div key={group.key} className="rounded-xl bg-muted/30 overflow-hidden">
              <button
                onClick={() => toggleExpand(group.key)}
                aria-expanded={open}
                className="w-full text-left p-3 space-y-2 active:bg-muted/50 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{packTitle}</p>
                    <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                      <Badge
                        variant="secondary"
                        className={`text-[10px] px-1.5 py-0 ${statusColor(rep.status, rep.trackedDownloadStatus)}`}
                      >
                        {statusLabel(rep)}
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 gap-1">
                        <Layers className="h-2.5 w-2.5" />
                        {group.items.length} episodes
                      </Badge>
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {rep.source}
                      </Badge>
                      {qualityName && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {qualityName}
                        </Badge>
                      )}
                      {rep.indexer && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                          {rep.indexer}
                        </Badge>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 mt-0.5">
                    {rep.timeleft && (
                      <span className="text-[10px] text-muted-foreground">{rep.timeleft}</span>
                    )}
                    <ChevronRight
                      className={`h-4 w-4 text-muted-foreground transition-transform ${open ? 'rotate-90' : ''}`}
                    />
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Progress value={progress} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                    {progress.toFixed(0)}%
                  </span>
                </div>
                <div className="flex items-center justify-between text-[10px] text-muted-foreground">
                  <span>Left: {formatBytes(rep.sizeleft)}</span>
                  <span>Total: {formatBytes(rep.size)}</span>
                </div>
              </button>

              {open && (
                <div className="border-t border-border/40 divide-y divide-border/30">
                  {episodes.map((ep) => {
                    const label = episodeLabel(ep);
                    return (
                      <button
                        key={`${ep.source}-${ep.id}`}
                        onClick={() => setSelectedItem(ep)}
                        className="w-full text-left px-3 py-2 flex items-center gap-2 active:bg-muted/50 transition-colors"
                      >
                        {label && (
                          <span className="text-[10px] font-mono text-muted-foreground tabular-nums shrink-0 w-11">
                            {label}
                          </span>
                        )}
                        <span className="text-xs truncate flex-1">
                          {ep.episode?.title || ep.title}
                        </span>
                        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Queue item detail drawer */}
      <Drawer open={!!selectedItem} onOpenChange={(open) => { if (!open) setSelectedItem(null); }}>
        <DrawerContent>
          {selectedItem && (() => {
            const progress = selectedItem.size > 0
              ? ((selectedItem.size - selectedItem.sizeleft) / selectedItem.size) * 100
              : 0;
            const qualityName = getQueueItemQuality(selectedItem);
            const customFormats = getQueueCustomFormats(selectedItem);
            const languageNames = selectedItem.languages?.map((language) => language.name).filter(Boolean).join(', ');
            const mediaHref = getQueueMediaHref(selectedItem);
            const mediaTitle = selectedItem.series?.title || selectedItem.movie?.title || undefined;
            const mediaSubtitle = selectedItem.episode
              ? `S${String(selectedItem.episode.seasonNumber).padStart(2, '0')}E${String(selectedItem.episode.episodeNumber).padStart(2, '0')} - ${selectedItem.episode.title}`
              : selectedItem.movie?.year
                ? String(selectedItem.movie.year)
                : selectedItem.seasonNumber
                  ? `Season ${selectedItem.seasonNumber}`
                  : undefined;

            return (
              <>
                <DrawerHeader className="text-left">
                  <Badge
                    variant="secondary"
                    className={`w-fit text-[10px] px-2 py-0.5 ${statusColor(selectedItem.status, selectedItem.trackedDownloadStatus)}`}
                  >
                    {statusLabel(selectedItem)}
                  </Badge>
                  <DrawerTitle className="text-sm break-all leading-snug mt-1">
                    {selectedItem.title}
                  </DrawerTitle>
                  <p className="text-xs text-muted-foreground">
                    {qualityName && `${qualityName} · `}
                    {formatBytes(selectedItem.size)}
                  </p>
                </DrawerHeader>

                <div className="px-4 space-y-4 pb-6">
                  {/* Tags row */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {selectedItem.source && (
                      <Badge variant="outline" className="text-[10px]">
                        {selectedItem.source?.toUpperCase()}
                      </Badge>
                    )}
                    {selectedItem.indexer && (
                      <Badge variant="outline" className="text-[10px]">
                        {selectedItem.indexer}
                      </Badge>
                    )}
                  </div>

                  {mediaHref && (
                    <Link
                      href={mediaHref}
                      className="flex items-center gap-2 rounded-lg bg-muted/30 p-3 hover:bg-muted/50 transition-colors"
                    >
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium truncate">{mediaTitle || selectedItem.title}</p>
                        {mediaSubtitle && (
                          <p className="text-xs text-muted-foreground mt-0.5 truncate">{mediaSubtitle}</p>
                        )}
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </Link>
                  )}

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{progress.toFixed(1)}%</span>
                      {selectedItem.timeleft && <span>{selectedItem.timeleft}</span>}
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {/* Remove button */}
                  {canManageActivity && (
                    <Button
                      variant="outline"
                      className="w-full border-destructive text-destructive hover:bg-destructive/10"
                      onClick={() => handleRemove(selectedItem.id, selectedItem.source || 'sonarr', selectedItem.instanceId)}
                      disabled={removing}
                    >
                      {removing ? (
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="mr-2 h-4 w-4" />
                      )}
                      Remove
                    </Button>
                  )}

                  {/* Information section */}
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Information</h3>
                    <div className="space-y-0 rounded-lg border divide-y">
                      <InfoRow label="Protocol" value={selectedItem.protocol || '-'} />
                      <InfoRow label="Client" value={selectedItem.downloadClient || '-'} />
                      <InfoRow label="Indexer" value={selectedItem.indexer || '-'} />
                      {qualityName && <InfoRow label="Quality" value={qualityName} />}
                      {typeof selectedItem.customFormatScore === 'number' && (
                        <InfoRow label="Custom Format Score" value={String(selectedItem.customFormatScore)} />
                      )}
                      {customFormats && <InfoRow label="Custom Formats" value={customFormats} />}
                      {languageNames && <InfoRow label="Languages" value={languageNames} />}
                      <InfoRow label="Total Size" value={formatBytes(selectedItem.size)} />
                      <InfoRow label="Size Left" value={formatBytes(selectedItem.sizeleft)} />
                      {selectedItem.estimatedCompletionTime && (
                        <InfoRow
                          label="ETA"
                          value={formatDistanceToNow(new Date(selectedItem.estimatedCompletionTime), { addSuffix: true })}
                        />
                      )}
                      {selectedItem.statusMessages?.length > 0 && (
                        <InfoRow
                          label="Messages"
                          value={selectedItem.statusMessages.map((m) => m.title).join(', ')}
                        />
                      )}
                    </div>
                  </div>
                </div>
              </>
            );
          })()}
        </DrawerContent>
      </Drawer>
    </>
  );
}

// --- Info row helper ---

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}

/**
 * Render the Failed Imports tab: list queue items that failed import and offer a manual import action.
 *
 * Shows loading skeletons while fetching; if no failed imports are found it renders an empty-state message;
 * otherwise it renders each failed item with its messages and an Import button that navigates to the manual import page.
 *
 * @param filterBy - Selected sources to apply (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources.
 * @returns The tab content JSX: loading skeletons, empty-state, or a list of failed import items with Import actions
 */

function FailedImportsTab({ filterBy, instanceFilter }: { filterBy: string[]; instanceFilter: string }) {
  const router = useRouter();
  const canManageActivity = useCan('activity.manage');
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  useEffect(() => {
    // Load the configured activity refresh interval (ms); falls back to 5s.
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('activityRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  // Shares the ['activity','queue'] cache with the Queue tab (same endpoint). The
  // tabs are mutually exclusive, so this tab needs its own poller — QueueTab's
  // interval doesn't run while Failed Imports is mounted.
  const queueQuery = useQuery({
    queryKey: ['activity', 'queue'],
    queryFn: jsonFetcher<{ records?: (QueueItem & { source?: string })[] }>('/api/activity/queue'),
    select: (d) => d.records ?? [],
    refetchInterval: backoffRefetchInterval(refreshIntervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const loading = queueQuery.isLoading;
  // Only import-blocked/stuck items, narrowed to the selected sources/instance.
  const queue = useMemo(() => {
    let failed = (queueQuery.data ?? []).filter(
      (r) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) === 'import'
    );
    if (filterBy.length > 0) {
      failed = failed.filter((r) => r.source !== undefined && filterBy.includes(r.source));
    }
    if (instanceFilter !== 'all') {
      failed = failed.filter((r) => r.instanceId === instanceFilter);
    }
    return failed;
  }, [queueQuery.data, filterBy, instanceFilter]);

  /**
   * Navigate to the manual import page for a queue item, embedding its identifiers in the query string.
   *
   * @param item - The queue item whose import page should be opened. Uses `downloadId`, `title`, and `source` (defaults to `"sonarr"`), and adds `seriesId` or `movieId` when present.
   */
  function openManualImport(item: QueueItem & { source?: string }) {
    const params = new URLSearchParams({
      downloadId: item.downloadId,
      source: item.source || 'sonarr',
      title: item.title || '',
    });
    if (item.seriesId) params.set('seriesId', String(item.seriesId));
    if (item.movieId) params.set('movieId', String(item.movieId));
    if (item.instanceId) params.set('instanceId', item.instanceId);
    router.push(`/activity/import?${params}`);
  }

  if (loading) {
    return <PageSpinner />;
  }

  if (queue.length === 0) {
    return (
      <div className="text-center py-16 text-muted-foreground">
        <FileWarning className="h-8 w-8 mx-auto mb-2 opacity-40" />
        <p className="text-sm">No failed imports</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-list-in">
      {queue.map((item) => (
        <div key={`${item.source}-${item.id}`} className="rounded-xl bg-muted/30 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <Badge
                variant="secondary"
                className="bg-red-500/10 text-red-500 border-red-500/20 mt-1 text-[10px]"
              >
                <AlertTriangle className="h-3 w-3 mr-1" /> {statusLabel(item)}
              </Badge>
              {item.statusMessages?.map((msg, i) => (
                <p key={i} className="text-xs text-muted-foreground mt-1 break-words">
                  {msg.title}: {msg.messages?.join(', ')}
                </p>
              ))}
            </div>
            {canManageActivity && (
              <Button size="sm" className="shrink-0 h-8 text-xs" onClick={() => openManualImport(item)}>
                <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
              </Button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Wanted Tab ---

interface WantedRecord {
  id: number;
  source: 'sonarr' | 'radarr' | 'lidarr';
  instanceId?: string;
  instanceLabel?: string;
  mediaType: 'episode' | 'movie' | 'album';
  title?: string;
  seriesId?: number;
  seasonNumber?: number;
  episodeNumber?: number;
  airDateUtc?: string;
  airDate?: string;
  series?: { id: number; title: string };
  year?: number;
  added?: string;
  monitored?: boolean;
  // Lidarr album fields
  artistId?: number;
  albumId?: number;
  releaseDate?: string;
  artist?: { id: number; artistName: string };
}

/**
 * Render the Wanted tab showing either missing or cutoff items with per-item search and pagination.
 *
 * @param type - Specifies which set of wanted items to display: `'missing'` or `'cutoff'`.
 * @param filterBy - Selected sources for results (`'sonarr'`, `'radarr'`, `'lidarr'`); an empty array means all sources, otherwise results are limited to the selected sources.
 * @returns The tab content element that lists records, shows loading and empty states, provides a per-record search action, and supports "Load more" pagination.
 */
function WantedTab({ type, filterBy, instanceFilter }: { type: 'missing' | 'cutoff'; filterBy: string[]; instanceFilter: string }) {
  const PAGE_SIZE = 20;
  const [searching, setSearching] = useState<string | null>(null);

  // The server filters and paginates for exactly this source set + instance, so
  // every filter combination is a genuinely different result — key on all of them
  // and request the page directly. No client-side filtering, no auto-advance.
  const wantedQuery = useInfiniteQuery({
    queryKey: ['activity', 'wanted', type, [...filterBy].sort().join(',') || 'all', instanceFilter],
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
  const records = wantedQuery.data?.pages.flatMap((pg) => pg.records ?? []) ?? [];

  // Surface fetch failures instead of silently rendering "No missing items" (or
  // stale rows under keepPreviousData). Mirrors the toast-on-error the action
  // handlers use; errorUpdatedAt re-fires it once per distinct failure.
  useEffect(() => {
    if (wantedQuery.isError) {
      toast.error('Failed to load wanted items');
    }
  }, [wantedQuery.isError, wantedQuery.errorUpdatedAt]);

  async function handleSearch(record: WantedRecord) {
    const key = `${record.source}-${record.id}`;
    setSearching(key);
    // Route the search command to the instance the wanted item lives on.
    const qs = record.instanceId ? `?instanceId=${record.instanceId}` : '';
    try {
      let res: Response;
      if (record.source === 'sonarr') {
        res = await fetch(`/api/sonarr/command${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [record.id] }),
        });
      } else if (record.source === 'lidarr') {
        res = await fetch(`/api/lidarr/command${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'AlbumSearch', albumIds: [record.id] }),
        });
      } else {
        res = await fetch(`/api/radarr/command${qs}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'MoviesSearch', movieIds: [record.id] }),
        });
      }
      if (!res.ok) throw new Error(`Search failed (${res.status})`);
      toast.success('Search started');
    } catch { toast.error('Search failed'); }
    finally { setSearching(null); }
  }

  if (loading) {
    return <PageSpinner />;
  }

  if (records.length === 0) {
    if (wantedQuery.isError) {
      return (
        <div className="text-center py-16 text-muted-foreground">
          <AlertTriangle className="h-8 w-8 mx-auto mb-2 opacity-40 text-red-500" />
          <p className="text-sm">Couldn&apos;t load wanted items</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => wantedQuery.refetch()}>
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" /> Retry
          </Button>
        </div>
      );
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

  return (
    <div className="space-y-1 animate-list-in">
      {records.map((record) => {
        const key = `${record.source}-${record.id}`;
        const isEpisode = record.mediaType === 'episode';
        const isAlbum = record.mediaType === 'album';
        const albumYear = record.releaseDate ? new Date(record.releaseDate).getFullYear() : undefined;
        const displayTitle = isEpisode
          ? `${record.series?.title || 'Unknown'} - S${String(record.seasonNumber ?? 0).padStart(2, '0')}E${String(record.episodeNumber ?? 0).padStart(2, '0')} - ${record.title || 'TBA'}`
          : isAlbum
            ? `${record.artist?.artistName ? `${record.artist.artistName} - ` : ''}${record.title || 'Unknown'}${albumYear ? ` (${albumYear})` : ''}`
            : `${record.title || 'Unknown'} (${record.year || '?'})`;
        const dateStr = isEpisode ? record.airDateUtc || record.airDate : isAlbum ? record.releaseDate : record.added;

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
          <div key={key} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors">
            {href ? (
              <Link href={href} className="p-1.5 rounded bg-muted hover:bg-muted/80 transition-colors">
                {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : isAlbum ? <Disc3 className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
              </Link>
            ) : (
              <div className="p-1.5 rounded bg-muted">
                {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : isAlbum ? <Disc3 className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
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
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Badge variant="outline" className="text-[10px] px-1.5 py-0">{record.source}</Badge>
                {dateStr && (
                  <span>{formatDistanceToNow(new Date(dateStr), { addSuffix: true })}</span>
                )}
              </div>
            </div>
            <Button
              size="sm"
              variant="ghost"
              className="h-7 w-7 p-0 shrink-0"
              onClick={() => handleSearch(record)}
              disabled={searching === key}
            >
              {searching === key ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Search className="h-3.5 w-3.5" />
              )}
            </Button>
          </div>
        );
      })}
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
    </div>
  );
}
