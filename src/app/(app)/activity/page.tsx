'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Download, Trash2, AlertTriangle,
  Upload, Loader2, RefreshCw, FileWarning, Search, Tv, Film, Disc3, Scissors,
  Clock, Filter, ArrowUpDown, ChevronRight,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { QueueItem } from '@/types';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { classifyQueueIssue } from '@/lib/queue-state';
import { useUIStore } from '@/lib/store';
import { InstanceFilter, type InstanceOption } from '@/components/instance-filter';
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
  const seriesId = item.seriesId ?? item.series?.id;
  const seasonNumber = item.seasonNumber ?? item.episode?.seasonNumber;
  const episodeId = item.episodeId ?? item.episode?.id;
  if (seriesId && seasonNumber && episodeId) {
    return `/series/${seriesId}/season/${seasonNumber}/episode/${episodeId}`;
  }
  if (seriesId && seasonNumber) {
    return `/series/${seriesId}/season/${seasonNumber}`;
  }
  if (seriesId) {
    return `/series/${seriesId}`;
  }
  const movieId = item.movieId ?? item.movie?.id;
  if (movieId) {
    return `/movies/${movieId}`;
  }
  const albumId = item.albumId ?? item.album?.id;
  if (albumId) {
    return `/music/album/${albumId}`;
  }
  const artistId = item.artistId ?? item.artist?.id;
  if (artistId) {
    return `/music/${artistId}`;
  }
  return null;
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
  const activityTab = useUIStore((s) => s.activityTab);
  const setActivityTab = useUIStore((s) => s.setActivityTab);
  const sortBy = useUIStore((s) => s.activitySortBy);
  const setSortBy = useUIStore((s) => s.setActivitySortBy);
  const filterBy = useUIStore((s) => s.activityFilterBy);
  const setFilterBy = useUIStore((s) => s.setActivityFilterBy);
  const instanceFilter = useUIStore((s) => s.activityInstanceFilter);
  const setInstanceFilter = useUIStore((s) => s.setActivityInstanceFilter);
  const urlTab = searchParams.get('tab');
  const searchParamsKey = searchParams.toString();
  const tab = urlTab && isTabKey(urlTab) ? urlTab : activityTab;
  const [refreshing, setRefreshing] = useState(false);
  const [queueCount, setQueueCount] = useState(0);
  const [instanceOptions, setInstanceOptions] = useState<InstanceOption[]>([]);

  // Load arr instances for the per-instance filter (shown only when >1 instance).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/services');
        if (!res.ok) return;
        const conns = (await res.json()) as Array<{ id: string; label: string; type: string }>;
        if (cancelled || !Array.isArray(conns)) return;
        setInstanceOptions(
          conns
            .filter((c) => c.type === 'SONARR' || c.type === 'RADARR' || c.type === 'LIDARR')
            .map((c) => ({ id: c.id, label: c.label }))
        );
      } catch {
        // ignore — filter just won't render
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Drop a stale instance selection if that instance no longer exists.
  useEffect(() => {
    if (instanceFilter !== 'all' && instanceOptions.length > 0 && !instanceOptions.some((i) => i.id === instanceFilter)) {
      setInstanceFilter('all');
    }
  }, [instanceOptions, instanceFilter, setInstanceFilter]);
  const initRef = useRef(false);
  const availableSortOptions = SORT_OPTIONS_BY_TAB[tab];

  useEffect(() => {
    if (!hasHydrated || initRef.current) return;
    const params = new URLSearchParams(searchParamsKey);
    const requestedTab = params.get('tab');
    const requestedSource = params.get('source');
    const requestedSort = params.get('sort');
    const currentState = useUIStore.getState();
    if (requestedTab && isTabKey(requestedTab) && requestedTab !== currentState.activityTab) {
      setActivityTab(requestedTab);
    }
    if (requestedSource && isFilterKey(requestedSource) && requestedSource !== 'all') {
      setFilterBy([requestedSource]);
    }
    if (requestedSort && isSortKey(requestedSort) && requestedSort !== currentState.activitySortBy) {
      setSortBy(requestedSort);
    }
    initRef.current = true;
  }, [hasHydrated, searchParamsKey, setActivityTab, setFilterBy, setSortBy]);

  function handleTabChange(nextTab: TabKey) {
    if (!isTabKey(nextTab)) return;
    setActivityTab(nextTab);

    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', nextTab);
    const query = params.toString();
    router.replace(query ? `/activity?${query}` : '/activity', { scroll: false });
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
              </DropdownMenuContent>
            </DropdownMenu>

            {/* Instance filter (only when >1 instance) */}
            <InstanceFilter instances={instanceOptions} value={instanceFilter} onChange={setInstanceFilter} align="start" />

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
  const [queue, setQueue] = useState<(QueueItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedItem, setSelectedItem] = useState<(QueueItem & { source?: string }) | null>(null);
  const [removing, setRemoving] = useState(false);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);

  const fetchQueue = useCallback(async () => {
    try {
      const res = await fetch('/api/activity/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data.records || []);
      }
    } catch { } finally { setLoading(false); }
  }, []);

  useEffect(() => {
    /**
     * Load the configured activity refresh interval (in milliseconds) and update the component's refreshIntervalMs state.
     *
     * Falls back to 5 seconds if no setting is present.
     */
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('activityRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  useEffect(() => {
    fetchQueue();
    const i = setInterval(fetchQueue, refreshIntervalMs);
    return () => clearInterval(i);
  }, [fetchQueue, refreshIntervalMs]);

  // Apply filter
  const filtered = queue.filter((item) =>
    (filterBy.length === 0 || (item.source !== undefined && filterBy.includes(item.source)))
    && (instanceFilter === 'all' || item.instanceId === instanceFilter)
  );

  // Apply sort
  const sorted = [...filtered].sort((a, b) => {
    switch (sortBy) {
      case 'title':
        return (a.title || '').localeCompare(b.title || '');
      case 'progress': {
        const pA = a.size > 0 ? (a.size - a.sizeleft) / a.size : 0;
        const pB = b.size > 0 ? (b.size - b.sizeleft) / b.size : 0;
        return pB - pA;
      }
      case 'timeleft':
        return (a.timeleft || 'zz').localeCompare(b.timeleft || 'zz');
      case 'size':
        return b.size - a.size;
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
      fetchQueue();
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
        {sorted.map((item) => {
          const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
          const qualityName = getQueueItemQuality(item);
          return (
            <button
              key={`${item.source}-${item.id}`}
              onClick={() => setSelectedItem(item)}
              className="w-full text-left rounded-xl bg-muted/30 p-3 space-y-2 active:bg-muted/50 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                    <Badge
                      variant="secondary"
                      className={`text-[10px] px-1.5 py-0 ${statusColor(item.status, item.trackedDownloadStatus)}`}
                    >
                      {statusLabel(item)}
                    </Badge>
                    <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                      {item.source}
                    </Badge>
                    {qualityName && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {qualityName}
                      </Badge>
                    )}
                    {typeof item.customFormatScore === 'number' && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        CF {item.customFormatScore}
                      </Badge>
                    )}
                    {item.indexer && (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                        {item.indexer}
                      </Badge>
                    )}
                  </div>
                </div>
                {item.timeleft && (
                  <span className="text-[10px] text-muted-foreground shrink-0 mt-0.5">
                    {item.timeleft}
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
                <span>Left: {formatBytes(item.sizeleft)}</span>
                <span>Total: {formatBytes(item.size)}</span>
              </div>
            </button>
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
  const [queue, setQueue] = useState<(QueueItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load queue items that need manual import and update component state.
   *
   * Fetches /api/activity/queue, selects records that classifyQueueIssue
   * marks as `'import'` (Sonarr/Radarr `importBlocked`, or `importPending`
   * with a warning/error status — the TBA-style stuck imports), narrows to the
   * selected `filterBy` sources when the array is non-empty, and stores the resulting
   * list via `setQueue`. Always calls `setLoading(false)` when finished;
   * errors are ignored.
   */
  const fetchFailed = useCallback(async () => {
    try {
      const res = await fetch('/api/activity/queue');
      if (res.ok) {
        const data = await res.json();
        let failed = (data.records || []).filter(
          (r: QueueItem) => classifyQueueIssue(r.trackedDownloadState, r.trackedDownloadStatus) === 'import'
        );
        if (filterBy.length > 0) {
          failed = failed.filter((r: QueueItem & { source?: string }) => r.source !== undefined && filterBy.includes(r.source));
        }
        if (instanceFilter !== 'all') {
          failed = failed.filter((r: QueueItem) => r.instanceId === instanceFilter);
        }
        setQueue(failed);
      }
    } catch { } finally { setLoading(false); }
  }, [filterBy, instanceFilter]);

  useEffect(() => { fetchFailed(); }, [filterBy, fetchFailed]);

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
  const [records, setRecords] = useState<WantedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [searching, setSearching] = useState<string | null>(null);

  const fetchWanted = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, page: String(p), pageSize: String(PAGE_SIZE) });
      // Server-side source filter only handles a single source; for multi-select
      // we fetch all and narrow client-side below.
      if (filterBy.length === 1) params.set('source', filterBy[0]);
      const res = await fetch(`/api/activity/wanted?${params}`);
      if (res.ok) {
        const data = await res.json();
        let incoming: WantedRecord[] = filterBy.length > 1
          ? (data.records || []).filter((r: WantedRecord) => filterBy.includes(r.source))
          : (data.records || []);
        if (instanceFilter !== 'all') {
          incoming = incoming.filter((r: WantedRecord) => r.instanceId === instanceFilter);
        }
        if (p === 1) setRecords(incoming);
        else setRecords((prev) => [...prev, ...incoming]);
        // totalRecords counts raw (unfiltered) records, so gate "Load more" on
        // whether the server has more raw pages — not the filtered local count,
        // which would keep the button visible after all matches are loaded.
        setHasMore(p * PAGE_SIZE < (data.totalRecords || 0));
      }
    } catch { } finally { setLoading(false); }
  }, [filterBy, type, instanceFilter]);

  useEffect(() => { setPage(1); fetchWanted(1); }, [fetchWanted]);

  async function handleSearch(record: WantedRecord) {
    const key = `${record.source}-${record.id}`;
    setSearching(key);
    try {
      let res: Response;
      if (record.source === 'sonarr') {
        res = await fetch('/api/sonarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [record.id] }),
        });
      } else if (record.source === 'lidarr') {
        res = await fetch('/api/lidarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'AlbumSearch', albumIds: [record.id] }),
        });
      } else {
        res = await fetch('/api/radarr/command', {
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

  if (loading && page === 1) {
    return <PageSpinner />;
  }

  if (records.length === 0) {
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
        const href = isAlbum
          ? `/music/album/${record.id}`
          : isEpisode && hasSeriesId && hasSeasonNumber
            ? `/series/${record.seriesId}/season/${record.seasonNumber}/episode/${record.id}`
            : isEpisode && hasSeriesId
              ? `/series/${record.seriesId}`
              : !isEpisode
                ? `/movies/${record.id}`
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
      {hasMore && (
        <Button
          variant="ghost"
          className="w-full"
          onClick={() => { const next = page + 1; setPage(next); fetchWanted(next); }}
          disabled={loading}
        >
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          Load more
        </Button>
      )}
    </div>
  );
}
