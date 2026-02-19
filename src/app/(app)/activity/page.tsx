'use client';

import { useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
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

// --- Main page ---

export default function ActivityPage() {
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>('queue');
  const [refreshing, setRefreshing] = useState(false);
  const [sortBy, setSortBy] = useState<SortKey>('progress');
  const [filterBy, setFilterBy] = useState<FilterKey>('all');
  const [queueCount, setQueueCount] = useState(0);
  const availableSortOptions = SORT_OPTIONS_BY_TAB[tab];

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
    <div className="flex flex-col min-h-0">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 pt-3 pb-2">
        <h1 className="text-xl font-bold">Activity</h1>
        <div className="flex items-center gap-1">
          {/* Filter */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8">
                <Filter className="h-4 w-4" />
              </Button>
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

      {/* Queue count */}
      {tab === 'queue' && queueCount > 0 && (
        <p className="px-4 text-xs text-muted-foreground mb-1">
          {queueCount} {queueCount === 1 ? 'Task' : 'Tasks'}
        </p>
      )}

      {/* Segmented control tabs */}
      <div className="px-4 pb-3">
        <div className="flex bg-muted/50 rounded-lg p-0.5 gap-0.5">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex-1 text-xs font-medium py-1.5 px-2 rounded-md transition-colors ${
                tab === t.key
                  ? 'bg-background text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
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

// --- Queue Tab ---

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

  async function fetchQueue() {
    try {
      const res = await fetch('/api/activity/queue');
      if (res.ok) {
        const data = await res.json();
        setQueue(data.records || []);
      }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => {
    fetchQueue();
    const i = setInterval(fetchQueue, 5000);
    return () => clearInterval(i);
  }, []);

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
    return (
      <div className="space-y-2">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
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
      <div className="space-y-2">
        {sorted.map((item) => {
          const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
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

                  {/* Progress bar */}
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{progress.toFixed(1)}%</span>
                      {selectedItem.timeleft && <span>{selectedItem.timeleft}</span>}
                    </div>
                    <Progress value={progress} className="h-2" />
                  </div>

                  {/* Remove button */}
                  <Button
                    variant="outline"
                    className="w-full border-destructive text-destructive hover:bg-destructive/10"
                    onClick={() => handleRemove(selectedItem.id, selectedItem.source || 'sonarr')}
                    disabled={removing}
                  >
                    {removing ? (
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Trash2 className="mr-2 h-4 w-4" />
                    )}
                    Remove
                  </Button>

                  {/* Information section */}
                  <div>
                    <h3 className="font-semibold text-sm mb-2">Information</h3>
                    <div className="space-y-0 rounded-lg border divide-y">
                      <InfoRow label="Protocol" value={selectedItem.protocol || '-'} />
                      <InfoRow label="Client" value={selectedItem.downloadClient || '-'} />
                      <InfoRow label="Indexer" value={selectedItem.indexer || '-'} />
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
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}

// --- Failed Imports Tab ---

function FailedImportsTab({ filterBy }: { filterBy: FilterKey }) {
  const router = useRouter();
  const [queue, setQueue] = useState<(QueueItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchFailed() {
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
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { fetchFailed(); }, [filterBy]);

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
    return (
      <div className="space-y-2">
        {[...Array(2)].map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
    );
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
    <div className="space-y-2">
      {queue.map((item) => (
        <div key={`${item.source}-${item.id}`} className="rounded-xl bg-muted/30 p-3 space-y-2">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium truncate">{item.title}</p>
              <Badge
                variant="secondary"
                className="bg-red-500/10 text-red-500 border-red-500/20 mt-1 text-[10px]"
              >
                <AlertTriangle className="h-3 w-3 mr-1" /> Import Failed
              </Badge>
              {item.statusMessages?.map((msg, i) => (
                <p key={i} className="text-xs text-muted-foreground mt-1 break-words">
                  {msg.title}: {msg.messages?.join(', ')}
                </p>
              ))}
            </div>
            <Button size="sm" className="shrink-0 h-8 text-xs" onClick={() => openManualImport(item)}>
              <Upload className="mr-1.5 h-3.5 w-3.5" /> Import
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
    } catch {} finally { setLoading(false); }
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
    return (
      <div className="space-y-2">
        {[...Array(5)].map((_, i) => (
          <Skeleton key={i} className="h-14 rounded-xl" />
        ))}
      </div>
    );
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
    <div className="space-y-1">
      {records.map((record) => {
        const key = `${record.source}-${record.id}`;
        const isEpisode = record.mediaType === 'episode';
        const displayTitle = isEpisode
          ? `${record.series?.title || 'Unknown'} - S${String(record.seasonNumber ?? 0).padStart(2, '0')}E${String(record.episodeNumber ?? 0).padStart(2, '0')} - ${record.title || 'TBA'}`
          : `${record.title || 'Unknown'} (${record.year || '?'})`;
        const dateStr = isEpisode ? record.airDateUtc || record.airDate : record.added;

        return (
          <div key={key} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50 active:bg-muted/50 transition-colors">
            <div className="p-1.5 rounded bg-muted">
              {isEpisode ? <Tv className="h-3.5 w-3.5 text-muted-foreground" /> : <Film className="h-3.5 w-3.5 text-muted-foreground" />}
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm truncate">{displayTitle}</p>
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
      {records.length < total && (
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
