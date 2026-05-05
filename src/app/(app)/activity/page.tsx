'use client';

import { useEffect, useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { Button } from '@/components/ui/button';
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
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip';
import {
  Download, Trash2, AlertTriangle,
  Upload, Loader2, RefreshCw, FileWarning, Search, Tv, Film, Scissors,
  Clock, Filter, ArrowUpDown,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { QueueItem } from '@/types';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';

// --- Status helpers ---

function statusColor(status: string, tracked?: string): React.CSSProperties {
  if (tracked === 'warning' || status === 'warning')
    return { background: 'oklch(0.78 0.16 78 / 0.16)', borderColor: 'oklch(0.78 0.16 78 / 0.4)', color: 'oklch(0.80 0.16 78)' };
  if (tracked === 'error' || status === 'failed')
    return { background: 'oklch(0.66 0.20 25 / 0.16)', borderColor: 'oklch(0.66 0.20 25 / 0.4)', color: 'oklch(0.78 0.18 25)' };
  if (status === 'completed' || status === 'imported')
    return { background: 'oklch(0.78 0.13 162 / 0.16)', borderColor: 'oklch(0.78 0.13 162 / 0.4)', color: 'oklch(0.78 0.13 162)' };
  if (status === 'downloading')
    return { background: 'var(--amber-soft)', borderColor: 'oklch(0.80 0.15 70 / 0.4)', color: 'var(--amber)' };
  if (status === 'queued' || status === 'delay')
    return { background: 'oklch(0.72 0.18 300 / 0.14)', borderColor: 'oklch(0.72 0.18 300 / 0.4)', color: 'oklch(0.80 0.16 300)' };
  return { background: 'var(--muted)', borderColor: 'var(--hairline)', color: 'var(--muted-foreground)' };
}

function statusPillStyle(status: string, tracked?: string): React.CSSProperties {
  return {
    borderRadius: '3px',
    letterSpacing: '0.22em',
    border: '1px solid',
    ...statusColor(status, tracked),
  };
}

function statusLabel(item: QueueItem & { source?: string }) {
  if (item.trackedDownloadState === 'importFailed') return 'IMPORT FAILED';
  if (item.trackedDownloadState === 'importPending') return 'IMPORT PENDING';
  if (item.trackedDownloadState === 'downloading') return 'DOWNLOADING';
  if (item.status === 'completed') return 'COMPLETED';
  if (item.status === 'queued') return 'QUEUED';
  if (item.status === 'delay') return 'DELAYED';
  if (item.status === 'paused') return 'PAUSED';
  return (item.trackedDownloadState || item.status || 'UNKNOWN').toUpperCase();
}

function formatBytes(bytes: number) {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
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

// --- Filter options ---

type FilterKey = 'all' | 'sonarr' | 'radarr';

const FILTER_OPTIONS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'sonarr', label: 'Sonarr' },
  { key: 'radarr', label: 'Radarr' },
];

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
  const [tab, setTab] = useState<TabKey>('queue');
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('progress');
  const [filterBy, setFilterBy] = useState<FilterKey>('all');
  const [queueCount, setQueueCount] = useState(0);
  const availableSortOptions = SORT_OPTIONS_BY_TAB[tab];

  useEffect(() => {
    const requestedTab = searchParams.get('tab');
    if (requestedTab && isTabKey(requestedTab)) {
      setTab(requestedTab);
    }
  }, [searchParams]);

  function handleTabChange(nextTab: TabKey) {
    if (!isTabKey(nextTab)) return;
    setTab(nextTab);

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
      await Promise.allSettled([
        fetch('/api/sonarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'RefreshMonitoredDownloads' }),
        }),
        fetch('/api/radarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'RefreshMonitoredDownloads' }),
        }),
      ]);
      toast.success('Activity refresh triggered');
    } catch {
      toast.error('Failed to refresh activity');
    } finally {
      setRefreshing(false);
    }
  }

  return (
    <div className="flex flex-col min-h-0 animate-content-in space-y-3">
      <div
        className="sticky z-30 -mx-3 px-3 md:-mx-8 md:px-8 pb-2.5 bg-background/85 backdrop-blur-xl supports-[backdrop-filter]:bg-background/70"
        style={{ top: 'var(--header-height, 0px)' }}
      >
        <div
          aria-hidden
          className="absolute inset-x-0 bottom-0 h-px"
          style={{ background: 'var(--hairline)' }}
        />

        {/* Status strip */}
        <div className="flex items-center gap-2 pt-1.5 pb-2">
          <span className="marquee-dot" aria-hidden />
          <span className="tracked-caps text-[9.5px] text-[color:var(--amber)]/85">
            Booth Activity · Live
          </span>
          <span className="hairline flex-1" aria-hidden />
          {tab === 'queue' && queueCount > 0 && (
            <span className="tracked-caps text-[9px] text-muted-foreground/70 font-mono tabular" style={{ letterSpacing: '0.22em' }}>
              {queueCount} {queueCount === 1 ? 'Task' : 'Tasks'}
            </span>
          )}
        </div>

        {/* Editorial tab strip */}
        <div className="flex items-end justify-between gap-3">
          <div className="flex items-center gap-0.5 sm:gap-1 overflow-x-auto scrollbar-hide -mx-1 px-1">
            {TABS.map((t) => {
              const active = tab === t.key;
              return (
                <button
                  key={t.key}
                  onClick={() => handleTabChange(t.key)}
                  className={`relative px-3 py-2 inline-flex items-center gap-2 whitespace-nowrap transition-colors ${
                    active ? 'text-foreground' : 'text-muted-foreground/70 hover:text-foreground'
                  }`}
                >
                  <span className="font-display text-[14px] sm:text-[15px]" style={{ letterSpacing: '-0.01em' }}>
                    {t.label}
                  </span>
                  <span
                    aria-hidden
                    className={`absolute left-2 right-2 -bottom-px h-px transition-all ${
                      active ? 'bg-[color:var(--amber)] opacity-100' : 'bg-foreground/20 opacity-0'
                    }`}
                  />
                  {active && (
                    <span
                      aria-hidden
                      className="absolute left-1/2 -translate-x-1/2 -bottom-1 w-1 h-1 rounded-full bg-[color:var(--amber)]"
                      style={{ boxShadow: '0 0 8px var(--amber-glow)' }}
                    />
                  )}
                </button>
              );
            })}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  className="press-feedback h-9 px-2.5 inline-flex items-center gap-1.5 border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
                  style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                  aria-label="Filter"
                >
                  <Filter className="h-3.5 w-3.5" />
                  <span className="tracked-caps text-[9px] hidden sm:inline">{FILTER_OPTIONS.find((o) => o.key === filterBy)?.label || 'All'}</span>
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                {FILTER_OPTIONS.map((opt) => (
                  <DropdownMenuItem
                    key={opt.key}
                    onClick={() => setFilterBy(opt.key)}
                    className={filterBy === opt.key ? 'bg-accent' : ''}
                  >
                    {opt.label}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>

            {availableSortOptions.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button
                    className="press-feedback h-9 w-9 inline-flex items-center justify-center border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
                    style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                    aria-label="Sort"
                  >
                    <ArrowUpDown className="h-3.5 w-3.5" />
                  </button>
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

            <button
              className="press-feedback h-9 w-9 inline-flex items-center justify-center border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
              style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
              onClick={() => router.push('/activity/history')}
              aria-label="History"
            >
              <Clock className="h-3.5 w-3.5" />
            </button>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  className="press-feedback h-9 w-9 inline-flex items-center justify-center border border-[color:var(--hairline)] bg-card/40 hover:bg-card/70 hover:border-[color:var(--amber-soft)] transition-colors"
                  style={{ borderRadius: 'calc(var(--radius) - 2px)' }}
                  onClick={handleRefreshActivity}
                  disabled={refreshing}
                  aria-label="Refresh"
                >
                  {refreshing ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--amber)]" />
                  ) : (
                    <RefreshCw className="h-3.5 w-3.5" />
                  )}
                </button>
              </TooltipTrigger>
              <TooltipContent>Refresh</TooltipContent>
            </Tooltip>
          </div>
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {tab === 'queue' && (
          <QueueTab
            sortBy={sortBy}
            filterBy={filterBy}
            onCountChange={setQueueCount}
          />
        )}
        {tab === 'failed' && <FailedImportsTab filterBy={filterBy} />}
        {tab === 'missing' && <WantedTab type="missing" filterBy={filterBy} />}
        {tab === 'cutoff' && <WantedTab type="cutoff" filterBy={filterBy} />}
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
 * @param filterBy - Source filter to limit items (e.g., 'all', 'sonarr', 'radarr')
 * @param onCountChange - Callback invoked with the current number of visible items after filtering and sorting
 * @returns The rendered Queue tab content as a JSX element
 */

function QueueTab({
  sortBy,
  filterBy,
  onCountChange,
}: {
  sortBy: SortKey;
  filterBy: FilterKey;
  onCountChange: (count: number) => void;
}) {
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
  const filtered = filterBy === 'all'
    ? queue
    : queue.filter((item) => item.source === filterBy);

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

  async function handleRemove(id: number, source: string) {
    setRemoving(true);
    try {
      await fetch(`/api/activity/queue/${id}?source=${source}&removeFromClient=true&blocklist=false`, { method: 'DELETE' });
      toast.success('Removed from queue');
      setSelectedItem(null);
      fetchQueue();
    } catch { toast.error('Failed to remove'); }
    finally { setRemoving(false); }
  }

  if (loading) {
    return <PageSpinner />;
  }

  if (sorted.length === 0) {
    return (
      <div
        className="border border-[color:var(--hairline)] bg-card/40 p-10 text-center space-y-3"
        style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
      >
        <div className="mx-auto h-10 w-10 rounded-full border border-[color:var(--hairline)] flex items-center justify-center">
          <Download className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="tracked-caps text-[10px] text-muted-foreground">Empty queue</p>
        <p className="font-display text-[18px]">Booth is idle.</p>
      </div>
    );
  }

  return (
    <>
      <div className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden animate-list-in" style={{ borderRadius: 'calc(var(--radius) - 1px)' }}>
        {sorted.map((item) => {
          const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
          return (
            <button
              key={`${item.source}-${item.id}`}
              onClick={() => setSelectedItem(item)}
              className="group w-full text-left px-3.5 py-3 space-y-2 border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/30 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="font-display text-[14px] truncate group-hover:text-[color:var(--amber)] transition-colors" style={{ letterSpacing: '-0.012em' }}>
                    {item.title}
                  </p>
                  <div className="flex items-center gap-1.5 mt-1.5 flex-wrap">
                    <span
                      className="tracked-caps text-[8.5px] px-1.5 py-0.5"
                      style={statusPillStyle(item.status, item.trackedDownloadStatus)}
                    >
                      {statusLabel(item)}
                    </span>
                    <span
                      className="tracked-caps text-[8.5px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                      style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                    >
                      {item.source}
                    </span>
                  </div>
                </div>
                {item.timeleft && (
                  <span className="font-mono tabular text-[10px] text-muted-foreground/85 shrink-0 mt-0.5">
                    {item.timeleft}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <div className="relative h-1 flex-1 bg-muted/40 overflow-hidden" style={{ borderRadius: '999px' }}>
                  <div
                    className="absolute inset-y-0 left-0 bg-[color:var(--amber)] transition-all"
                    style={{ width: `${progress}%`, boxShadow: '0 0 8px var(--amber-glow)' }}
                  />
                </div>
                <span className="font-mono tabular text-[10px] text-[color:var(--amber)] shrink-0">
                  {progress.toFixed(0)}%
                </span>
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
            const qualityName = selectedItem.episode
              ? undefined
              : selectedItem.movie?.movieFile?.quality?.quality?.name;

            return (
              <>
                <DrawerHeader className="text-left space-y-1.5">
                  <span
                    className="w-fit tracked-caps text-[9px] px-1.5 py-0.5"
                    style={statusPillStyle(selectedItem.status, selectedItem.trackedDownloadStatus)}
                  >
                    {statusLabel(selectedItem)}
                  </span>
                  <DrawerTitle className="font-display text-[18px] break-all leading-snug" style={{ letterSpacing: '-0.018em' }}>
                    {selectedItem.title}
                  </DrawerTitle>
                  <p className="font-mono tabular text-[11px] text-muted-foreground/85">
                    {qualityName && `${qualityName} · `}
                    {formatBytes(selectedItem.size)}
                  </p>
                </DrawerHeader>

                <div className="px-4 space-y-5 pb-6">
                  {/* Tags row */}
                  <div className="flex items-center gap-1.5 flex-wrap">
                    {selectedItem.source && (
                      <span className="tracked-caps text-[8.5px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground" style={{ borderRadius: '3px', letterSpacing: '0.22em' }}>
                        {selectedItem.source?.toUpperCase()}
                      </span>
                    )}
                    {selectedItem.indexer && (
                      <span className="tracked-caps text-[8.5px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground" style={{ borderRadius: '3px', letterSpacing: '0.22em' }}>
                        {selectedItem.indexer}
                      </span>
                    )}
                  </div>

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between font-mono tabular text-[10.5px] text-muted-foreground/85 mb-1.5">
                      <span className="text-[color:var(--amber)]">{progress.toFixed(1)}%</span>
                      {selectedItem.timeleft && <span>{selectedItem.timeleft}</span>}
                    </div>
                    <div className="relative h-1.5 bg-muted/40 overflow-hidden" style={{ borderRadius: '999px' }}>
                      <div
                        className="absolute inset-y-0 left-0 bg-[color:var(--amber)] transition-all"
                        style={{ width: `${progress}%`, boxShadow: '0 0 10px var(--amber-glow)' }}
                      />
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    className="w-full h-11 border-destructive/40 text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemove(selectedItem.id, selectedItem.source || 'sonarr')}
                    disabled={removing}
                  >
                    {removing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="h-4 w-4" />
                    )}
                    <span className="tracked-caps text-[10px]">Remove</span>
                  </Button>

                  <div className="space-y-2">
                    <p className="tracked-caps text-[9.5px] text-muted-foreground" style={{ letterSpacing: '0.22em' }}>Information</p>
                    <div className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden" style={{ borderRadius: 'calc(var(--radius) - 1px)' }}>
                      <InfoRow label="Protocol" value={selectedItem.protocol || '—'} />
                      <InfoRow label="Client" value={selectedItem.downloadClient || '—'} />
                      <InfoRow label="Indexer" value={selectedItem.indexer || '—'} />
                      <InfoRow label="Size" value={formatBytes(selectedItem.size)} />
                      <InfoRow label="Remaining" value={formatBytes(selectedItem.sizeleft)} />
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
    <div className="flex items-baseline justify-between gap-3 px-3.5 py-2.5 border-b border-[color:var(--hairline)] last:border-b-0">
      <span className="tracked-caps text-[9px] text-muted-foreground" style={{ letterSpacing: '0.24em' }}>
        {label}
      </span>
      <span className="font-mono tabular text-[12px] text-right max-w-[60%] break-words">
        {value}
      </span>
    </div>
  );
}

/**
 * Render the Failed Imports tab: list queue items that failed import and offer a manual import action.
 *
 * Shows loading skeletons while fetching; if no failed imports are found it renders an empty-state message;
 * otherwise it renders each failed item with its messages and an Import button that navigates to the manual import page.
 *
 * @param filterBy - Source filter to apply (`'all'`, `'sonarr'`, or `'radarr'`)
 * @returns The tab content JSX: loading skeletons, empty-state, or a list of failed import items with Import actions
 */

function FailedImportsTab({ filterBy }: { filterBy: FilterKey }) {
  const router = useRouter();
  const [queue, setQueue] = useState<(QueueItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  /**
   * Load failed import entries from the activity queue and update component state.
   *
   * Fetches /api/activity/queue, selects records whose `trackedDownloadState` is
   * `"importFailed"` or whose `trackedDownloadStatus` is `"warning"`, applies the
   * `filterBy` source filter when it is not `"all"`, and stores the resulting list
   * via `setQueue`. Always calls `setLoading(false)` when finished; errors are
   * ignored.
   */
  const fetchFailed = useCallback(async () => {
    try {
      const res = await fetch('/api/activity/queue');
      if (res.ok) {
        const data = await res.json();
        let failed = (data.records || []).filter(
          (r: QueueItem) => r.trackedDownloadState === 'importFailed' || r.trackedDownloadStatus === 'warning'
        );
        if (filterBy !== 'all') {
          failed = failed.filter((r: QueueItem & { source?: string }) => r.source === filterBy);
        }
        setQueue(failed);
      }
    } catch { } finally { setLoading(false); }
  }, [filterBy]);

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
    router.push(`/activity/import?${params}`);
  }

  if (loading) {
    return <PageSpinner />;
  }

  if (queue.length === 0) {
    return (
      <div
        className="border border-[color:var(--hairline)] bg-card/40 p-10 text-center space-y-3"
        style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
      >
        <div className="mx-auto h-10 w-10 rounded-full border border-[color:var(--hairline)] flex items-center justify-center">
          <FileWarning className="h-4 w-4 text-muted-foreground" />
        </div>
        <p className="tracked-caps text-[10px] text-muted-foreground">No failed imports</p>
        <p className="font-display text-[18px]">Clean booth.</p>
      </div>
    );
  }

  return (
    <div className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden animate-list-in" style={{ borderRadius: 'calc(var(--radius) - 1px)' }}>
      {queue.map((item) => (
        <div key={`${item.source}-${item.id}`} className="px-3.5 py-3 space-y-2 border-b border-[color:var(--hairline)] last:border-b-0">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="font-display text-[14px] truncate" style={{ letterSpacing: '-0.012em' }}>{item.title}</p>
              <span
                className="inline-flex items-center gap-1 mt-1.5 tracked-caps text-[8.5px] px-1.5 py-0.5"
                style={statusPillStyle('failed')}
              >
                <AlertTriangle className="h-2.5 w-2.5" />
                Import Failed
              </span>
              {item.statusMessages?.map((msg, i) => (
                <p key={i} className="text-[11.5px] text-muted-foreground/85 mt-1.5 break-words leading-snug">
                  <span className="text-foreground/90">{msg.title}:</span> {msg.messages?.join(', ')}
                </p>
              ))}
            </div>
            <Button size="sm" className="shrink-0 h-8 cta-sheen projector-glow" onClick={() => openManualImport(item)}>
              <Upload className="h-3 w-3" />
              <span className="tracked-caps text-[9.5px]">Import</span>
            </Button>
          </div>
        </div>
      ))}
    </div>
  );
}

// --- Wanted Tab ---

interface WantedRecord {
  id: number;
  source: 'sonarr' | 'radarr';
  mediaType: 'episode' | 'movie';
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
}

/**
 * Render the Wanted tab showing either missing or cutoff items with per-item search and pagination.
 *
 * @param type - Specifies which set of wanted items to display: `'missing'` or `'cutoff'`.
 * @param filterBy - Source filter for results (`'all'`, `'sonarr'`, or `'radarr'`); when not `'all'` the list is limited to that source.
 * @returns The tab content element that lists records, shows loading and empty states, provides a per-record search action, and supports "Load more" pagination.
 */
function WantedTab({ type, filterBy }: { type: 'missing' | 'cutoff'; filterBy: FilterKey }) {
  const [records, setRecords] = useState<WantedRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [searching, setSearching] = useState<string | null>(null);

  const fetchWanted = useCallback(async (p: number) => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ type, page: String(p), pageSize: '20' });
      if (filterBy !== 'all') params.set('source', filterBy);
      const res = await fetch(`/api/activity/wanted?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (p === 1) setRecords(data.records || []);
        else setRecords((prev) => [...prev, ...(data.records || [])]);
        setTotal(data.totalRecords || 0);
      }
    } catch { } finally { setLoading(false); }
  }, [filterBy, type]);

  useEffect(() => { setPage(1); fetchWanted(1); }, [fetchWanted]);

  async function handleSearch(record: WantedRecord) {
    const key = `${record.source}-${record.id}`;
    setSearching(key);
    try {
      if (record.source === 'sonarr') {
        await fetch('/api/sonarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'EpisodeSearch', episodeIds: [record.id] }),
        });
      } else {
        await fetch('/api/radarr/command', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: 'MoviesSearch', movieIds: [record.id] }),
        });
      }
      toast.success('Search started');
    } catch { toast.error('Search failed'); }
    finally { setSearching(null); }
  }

  if (loading && page === 1) {
    return <PageSpinner />;
  }

  if (records.length === 0) {
    return (
      <div
        className="border border-[color:var(--hairline)] bg-card/40 p-10 text-center space-y-3"
        style={{ borderRadius: 'calc(var(--radius) - 1px)' }}
      >
        <div className="mx-auto h-10 w-10 rounded-full border border-[color:var(--hairline)] flex items-center justify-center">
          {type === 'missing' ? <Download className="h-4 w-4 text-muted-foreground" /> : <Scissors className="h-4 w-4 text-muted-foreground" />}
        </div>
        <p className="tracked-caps text-[10px] text-muted-foreground">
          {type === 'missing' ? 'No missing items' : 'No cutoff items'}
        </p>
        <p className="font-display text-[18px]">All caught up.</p>
      </div>
    );
  }

  return (
    <div className="space-y-2 animate-list-in">
      <div className="border border-[color:var(--hairline)] bg-card/40 overflow-hidden" style={{ borderRadius: 'calc(var(--radius) - 1px)' }}>
        {records.map((record) => {
          const key = `${record.source}-${record.id}`;
          const isEpisode = record.mediaType === 'episode';
          const displayTitle = isEpisode
            ? `${record.series?.title || 'Unknown'} - S${String(record.seasonNumber ?? 0).padStart(2, '0')}E${String(record.episodeNumber ?? 0).padStart(2, '0')} - ${record.title || 'TBA'}`
            : `${record.title || 'Unknown'} (${record.year || '?'})`;
          const dateStr = isEpisode ? record.airDateUtc || record.airDate : record.added;

          const hasSeriesId = Number.isFinite(record.seriesId);
          const hasSeasonNumber = Number.isFinite(record.seasonNumber);
          const href = isEpisode && hasSeriesId && hasSeasonNumber
            ? `/series/${record.seriesId}/season/${record.seasonNumber}/episode/${record.id}`
            : isEpisode && hasSeriesId
              ? `/series/${record.seriesId}`
              : !isEpisode
                ? `/movies/${record.id}`
                : null;

          return (
            <div
              key={key}
              className="group flex items-center gap-3 py-2.5 px-3.5 border-b border-[color:var(--hairline)] last:border-b-0 hover:bg-[color:var(--amber-soft)]/30 transition-colors"
            >
              {href ? (
                <Link
                  href={href}
                  className="h-8 w-8 inline-flex items-center justify-center bg-card/60 border border-[color:var(--hairline)] hover:border-[color:var(--amber-soft)] transition-colors shrink-0"
                  style={{ borderRadius: 'calc(var(--radius) - 3px)' }}
                >
                  {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                </Link>
              ) : (
                <div
                  className="h-8 w-8 inline-flex items-center justify-center bg-card/40 border border-[color:var(--hairline)] shrink-0"
                  style={{ borderRadius: 'calc(var(--radius) - 3px)' }}
                >
                  {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
                </div>
              )}
              <div className="flex-1 min-w-0">
                {href ? (
                  <Link href={href} className="block">
                    <p className="font-display text-[13.5px] truncate group-hover:text-[color:var(--amber)] transition-colors" style={{ letterSpacing: '-0.012em' }}>
                      {displayTitle}
                    </p>
                  </Link>
                ) : (
                  <p className="font-display text-[13.5px] truncate" style={{ letterSpacing: '-0.012em' }}>{displayTitle}</p>
                )}
                <div className="flex items-center gap-2 mt-0.5">
                  <span
                    className="tracked-caps text-[8px] px-1.5 py-0.5 border border-[color:var(--hairline)] bg-card/50 text-muted-foreground"
                    style={{ borderRadius: '3px', letterSpacing: '0.22em' }}
                  >
                    {record.source}
                  </span>
                  {dateStr && (
                    <span className="font-mono tabular text-[10px] text-muted-foreground/85">
                      {formatDistanceToNow(new Date(dateStr), { addSuffix: true })}
                    </span>
                  )}
                </div>
              </div>
              <button
                className="press-feedback h-8 w-8 inline-flex items-center justify-center shrink-0 hover:text-[color:var(--amber)] transition-colors"
                onClick={() => handleSearch(record)}
                disabled={searching === key}
                aria-label="Search"
              >
                {searching === key ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-[color:var(--amber)]" />
                ) : (
                  <Search className="h-3.5 w-3.5" />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {records.length < total && (
        <Button
          variant="outline"
          className="w-full h-10 cta-sheen"
          onClick={() => { const next = page + 1; setPage(next); fetchWanted(next); }}
          disabled={loading}
        >
          {loading && <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="tracked-caps text-[10px]">Load more</span>
        </Button>
      )}
    </div>
  );
}
