'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { useWindowVirtualRange } from '@/hooks/use-window-virtual-range';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
  DrawerFooter,
  DrawerClose,
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
  Play,
  Pause,
  Zap,
  Trash2,
  Plus,
  MoreVertical,
  Loader2,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';
import type {
  QBittorrentTorrent,
  QBittorrentSummaryResponse,
  QBittorrentTransferInfo,
} from '@/types';
import type { TorrentFile, TorrentTracker } from '@/lib/qbittorrent-client';

const VIRTUALIZE_THRESHOLD = 40;
const TORRENT_ROW_HEIGHT = 140;

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec: number): string {
  return formatBytes(bytesPerSec) + '/s';
}

function formatEta(seconds: number): string {
  if (seconds <= 0 || seconds === 8640000) return '';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function getStateBadge(state: string) {
  const stateMap: Record<string, { label: string; variant: 'default' | 'secondary' | 'destructive' | 'outline' }> = {
    downloading: { label: 'Downloading', variant: 'default' },
    stalledDL: { label: 'Stalled', variant: 'secondary' },
    uploading: { label: 'Seeding', variant: 'default' },
    stalledUP: { label: 'Seeding', variant: 'secondary' },
    pausedDL: { label: 'Paused', variant: 'outline' },
    pausedUP: { label: 'Paused', variant: 'outline' },
    queuedDL: { label: 'Queued', variant: 'secondary' },
    queuedUP: { label: 'Queued', variant: 'secondary' },
    checkingDL: { label: 'Checking', variant: 'secondary' },
    checkingUP: { label: 'Checking', variant: 'secondary' },
    forcedDL: { label: 'Forced DL', variant: 'default' },
    forcedUP: { label: 'Forced UL', variant: 'default' },
    missingFiles: { label: 'Missing', variant: 'destructive' },
    error: { label: 'Error', variant: 'destructive' },
    moving: { label: 'Moving', variant: 'secondary' },
  };

  const s = stateMap[state] || { label: state, variant: 'secondary' as const };
  return <Badge variant={s.variant} className="text-[10px] px-1.5 py-0">{s.label}</Badge>;
}

type FilterType = 'all' | 'downloading' | 'seeding' | 'completed' | 'paused' | 'active';

const filterOptions: { value: FilterType; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'downloading', label: 'Downloading' },
  { value: 'seeding', label: 'Seeding' },
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'active', label: 'Active' },
];

function sameTorrent(a: QBittorrentTorrent, b: QBittorrentTorrent): boolean {
  return (
    a.hash === b.hash
    && a.name === b.name
    && a.size === b.size
    && a.progress === b.progress
    && a.dlspeed === b.dlspeed
    && a.upspeed === b.upspeed
    && a.num_seeds === b.num_seeds
    && a.num_leechs === b.num_leechs
    && a.state === b.state
    && a.eta === b.eta
    && a.category === b.category
    && a.tags === b.tags
    && a.added_on === b.added_on
    && a.completion_on === b.completion_on
    && a.save_path === b.save_path
  );
}

function mergeTorrents(prev: QBittorrentTorrent[], next: QBittorrentTorrent[]): QBittorrentTorrent[] {
  if (prev.length === 0) return next;

  const prevByHash = new Map(prev.map((torrent) => [torrent.hash, torrent]));
  let changed = prev.length !== next.length;

  const merged = next.map((torrent) => {
    const existing = prevByHash.get(torrent.hash);
    if (existing && sameTorrent(existing, torrent)) {
      return existing;
    }
    changed = true;
    return torrent;
  });

  return changed ? merged : prev;
}

interface TorrentRowProps {
  torrent: QBittorrentTorrent;
  selected: boolean;
  onToggleSelect: (hash: string) => void;
  onFetchDetail: (hash: string) => void;
  onTorrentAction: (hash: string, action: string, extra?: Record<string, unknown>) => void;
  onOpenDeleteDrawer: (hash: string, name: string, deleteFiles: boolean) => void;
}

const TorrentRow = memo(function TorrentRow({
  torrent,
  selected,
  onToggleSelect,
  onFetchDetail,
  onTorrentAction,
  onOpenDeleteDrawer,
}: TorrentRowProps) {
  return (
    <div className="px-3 py-3 sm:px-4">
      <div className="flex items-start gap-3">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(torrent.hash)}
          className="mt-1 rounded border-border"
        />
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <button
              className="text-sm font-medium truncate text-left hover:underline"
              onClick={() => onFetchDetail(torrent.hash)}
            >
              {torrent.name}
            </button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-0.5">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'start')}>
                  <Play className="mr-2 h-4 w-4" /> Start
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'stop')}>
                  <Pause className="mr-2 h-4 w-4" /> Stop
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'forceStart')}>
                  <Zap className="mr-2 h-4 w-4" /> Force Start
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => onOpenDeleteDrawer(torrent.hash, torrent.name, false)}>
                  <Trash2 className="mr-2 h-4 w-4" /> Delete (keep files)
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="text-destructive"
                  onClick={() => onOpenDeleteDrawer(torrent.hash, torrent.name, true)}
                >
                  <Trash2 className="mr-2 h-4 w-4" /> Delete with files
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {getStateBadge(torrent.state)}
            <span className="text-[11px] text-muted-foreground">{formatBytes(torrent.size)}</span>
            {torrent.category && (
              <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate max-w-[120px]">
                {torrent.category}
              </Badge>
            )}
          </div>

          <div className="mt-2">
            <div className="flex justify-between text-[11px] text-muted-foreground mb-1 flex-wrap gap-x-2">
              <span>{(torrent.progress * 100).toFixed(1)}%</span>
              <span className="flex items-center flex-wrap gap-x-2">
                {torrent.dlspeed > 0 && (
                  <span className="text-green-500">
                    <ArrowDown className="inline h-3 w-3" /> {formatSpeed(torrent.dlspeed)}
                  </span>
                )}
                {torrent.upspeed > 0 && (
                  <span className="text-blue-500">
                    <ArrowUp className="inline h-3 w-3" /> {formatSpeed(torrent.upspeed)}
                  </span>
                )}
                {torrent.eta > 0 && torrent.eta < 8640000 && (
                  <span>ETA: {formatEta(torrent.eta)}</span>
                )}
              </span>
            </div>
            <Progress value={torrent.progress * 100} className="h-1" />
          </div>

          <div className="flex items-center gap-3 mt-1.5 text-[11px] text-muted-foreground">
            <span>Seeds: {torrent.num_seeds}</span>
            <span>Peers: {torrent.num_leechs}</span>
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => prevProps.selected === nextProps.selected && prevProps.torrent === nextProps.torrent);

export default function TorrentsPage() {
  const router = useRouter();
  const [torrents, setTorrents] = useState<QBittorrentTorrent[]>([]);
  const [transferInfo, setTransferInfo] = useState<QBittorrentTransferInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());

  const [detailHash, setDetailHash] = useState<string | null>(null);
  const [detailData, setDetailData] = useState<{
    properties: Record<string, unknown>;
    files: TorrentFile[];
    trackers: TorrentTracker[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const [deleteDrawer, setDeleteDrawer] = useState<{ open: boolean; hash: string; name: string; deleteFiles: boolean }>({
    open: false,
    hash: '',
    name: '',
    deleteFiles: false,
  });
  const [deleting, setDeleting] = useState(false);

  const listRef = useRef<HTMLDivElement | null>(null);
  const filterRef = useRef<FilterType>('all');
  const pollInFlightRef = useRef(false);
  const pendingPollRef = useRef(false);

  const fetchSummary = useCallback(async () => {
    if (pollInFlightRef.current) {
      pendingPollRef.current = true;
      return;
    }

    pollInFlightRef.current = true;
    const currentFilter = filterRef.current;
    const startedAt = performance.now();

    try {
      const qbtFilter = currentFilter === 'all' ? undefined : currentFilter;
      const url = qbtFilter
        ? `/api/qbittorrent/summary?filter=${encodeURIComponent(qbtFilter)}`
        : '/api/qbittorrent/summary';

      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');

      const data = await res.json() as QBittorrentSummaryResponse & { error?: string };
      if (data.error) throw new Error(data.error);

      setTorrents((prev) => mergeTorrents(prev, data.torrents));
      setTransferInfo(data.transferInfo);
      setError(null);

      const durationMs = performance.now() - startedAt;
      console.info(`[perf][client] torrents summary ${durationMs.toFixed(1)}ms`, {
        filter: currentFilter,
        torrentCount: data.torrents.length,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch torrents');
    } finally {
      setLoading(false);
      setRefreshing(false);
      pollInFlightRef.current = false;

      if (pendingPollRef.current) {
        pendingPollRef.current = false;
        void fetchSummary();
      }
    }
  }, []);

  const fetchDetail = useCallback(async (hash: string) => {
    setDetailHash(hash);
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await fetch(`/api/qbittorrent/${hash}/details`);
      if (res.ok) {
        setDetailData(await res.json());
      } else {
        toast.error('Failed to load torrent details');
      }
    } catch {
      toast.error('Failed to load torrent details');
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    filterRef.current = filter;
    setLoading(true);
    void fetchSummary();
  }, [fetchSummary, filter]);

  useEffect(() => {
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

  useEffect(() => {
    const interval = setInterval(() => {
      void fetchSummary();
    }, refreshIntervalMs);
    return () => clearInterval(interval);
  }, [fetchSummary, refreshIntervalMs]);

  useEffect(() => {
    setSelectedTorrents((prev) => {
      if (prev.size === 0) return prev;
      const availableHashes = new Set(torrents.map((torrent) => torrent.hash));
      const next = new Set(Array.from(prev).filter((hash) => availableHashes.has(hash)));
      return next.size === prev.size ? prev : next;
    });
  }, [torrents]);

  const torrentAction = useCallback(async (hash: string, action: string, extra?: Record<string, unknown>) => {
    try {
      const res = await fetch(`/api/qbittorrent/${hash}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Action failed');
      }
      const successMessage: Record<string, string> = {
        start: 'Started',
        stop: 'Stopped',
        forceStart: 'Force started',
        delete: 'Deleted',
      };
      toast.success(successMessage[action] ?? 'Action successful');
      setTimeout(() => {
        void fetchSummary();
      }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  }, [fetchSummary]);

  const bulkAction = useCallback(async (action: string) => {
    if (selectedTorrents.size === 0) return;
    const hashes = Array.from(selectedTorrents).join('|');
    await torrentAction(hashes, action);
    setSelectedTorrents(new Set());
  }, [selectedTorrents, torrentAction]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    try {
      await torrentAction(deleteDrawer.hash, 'delete', { deleteFiles: deleteDrawer.deleteFiles });
      setDeleteDrawer({ open: false, hash: '', name: '', deleteFiles: false });
    } catch {
      // Error handled in torrentAction
    } finally {
      setDeleting(false);
    }
  }, [deleteDrawer.deleteFiles, deleteDrawer.hash, torrentAction]);

  const toggleSelect = useCallback((hash: string) => {
    setSelectedTorrents((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }, []);

  const openDeleteDrawer = useCallback((hash: string, name: string, deleteFiles: boolean) => {
    setDeleteDrawer({ open: true, hash, name, deleteFiles });
  }, []);

  const filteredTorrents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return torrents;
    return torrents.filter((torrent) => torrent.name.toLowerCase().includes(q));
  }, [search, torrents]);

  const useVirtualization = filteredTorrents.length > VIRTUALIZE_THRESHOLD;
  const virtualRange = useWindowVirtualRange({
    container: listRef.current,
    itemCount: filteredTorrents.length,
    itemSize: TORRENT_ROW_HEIGHT,
    enabled: useVirtualization,
    overscan: 8,
  });

  const visibleTorrents = useMemo(() => {
    if (!useVirtualization) return filteredTorrents;
    return filteredTorrents.slice(virtualRange.startIndex, virtualRange.endIndex);
  }, [filteredTorrents, useVirtualization, virtualRange.endIndex, virtualRange.startIndex]);

  const torrentNameByHash = useMemo(
    () => new Map(torrents.map((torrent) => [torrent.hash, torrent.name])),
    [torrents]
  );

  const activeFilterLabel = filterOptions.find((o) => o.value === filter)?.label ?? 'All';

  const selectAll = useCallback(() => {
    if (selectedTorrents.size === filteredTorrents.length) {
      setSelectedTorrents(new Set());
      return;
    }
    setSelectedTorrents(new Set(filteredTorrents.map((torrent) => torrent.hash)));
  }, [filteredTorrents, selectedTorrents.size]);

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              aria-label={`Filter: ${activeFilterLabel}`}
            >
              <Filter className="h-5 w-5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-48">
            <DropdownMenuLabel>Filter</DropdownMenuLabel>
            <DropdownMenuSeparator />
            {filterOptions.map((opt) => (
              <DropdownMenuCheckboxItem
                key={opt.value}
                checked={filter === opt.value}
                onCheckedChange={() => setFilter(opt.value)}
              >
                {opt.label}
              </DropdownMenuCheckboxItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
              onClick={() => {
                setRefreshing(true);
                if (torrents.length === 0) setLoading(true);
                void fetchSummary();
              }}
              aria-label="Refresh"
            >
              <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
            </button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        {transferInfo && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground ml-1">
            <span className="flex items-center gap-1">
              <ArrowDown className="h-3 w-3 text-green-500" />
              {formatSpeed(transferInfo.dl_info_speed)}
            </span>
            <span className="flex items-center gap-1">
              <ArrowUp className="h-3 w-3 text-blue-500" />
              {formatSpeed(transferInfo.up_info_speed)}
            </span>
          </div>
        )}

        <div className="flex-1" />

        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
              onClick={() => router.push('/torrents/add')}
              aria-label="Add Torrent"
            >
              <Plus className="h-5 w-5" />
            </button>
          </TooltipTrigger>
          <TooltipContent>Add Torrent</TooltipContent>
        </Tooltip>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {selectedTorrents.size > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/60 rounded-xl">
          <span className="text-xs text-muted-foreground mx-1 shrink-0">{selectedTorrents.size}</span>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => void bulkAction('start')}
            aria-label="Start"
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => void bulkAction('stop')}
            aria-label="Stop"
          >
            <Pause className="h-4 w-4" />
          </button>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => void bulkAction('forceStart')}
            aria-label="Force Start"
          >
            <Zap className="h-4 w-4" />
          </button>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent text-destructive"
            onClick={() => {
              const hashes = Array.from(selectedTorrents).join('|');
              setDeleteDrawer({
                open: true,
                hash: hashes,
                name: `${selectedTorrents.size} torrents`,
                deleteFiles: false,
              });
            }}
            aria-label="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
          <div className="flex-1" />
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent text-xs text-muted-foreground"
            onClick={() => setSelectedTorrents(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {loading && torrents.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{error}</p>
          <p className="text-sm mt-2">Make sure qBittorrent is configured in Settings.</p>
        </div>
      ) : filteredTorrents.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          {search ? 'No torrents match your search.' : 'No torrents found.'}
        </div>
      ) : (
        <div className="space-y-0" ref={listRef}>
          <div className="flex items-center gap-2 px-3 pb-2">
            <input
              type="checkbox"
              checked={selectedTorrents.size === filteredTorrents.length && filteredTorrents.length > 0}
              onChange={selectAll}
              className="rounded border-border"
            />
            <span className="text-xs text-muted-foreground">
              {filteredTorrents.length} torrent{filteredTorrents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {useVirtualization && virtualRange.topSpacerHeight > 0 && (
            <div style={{ height: virtualRange.topSpacerHeight }} />
          )}

          <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
            {visibleTorrents.map((torrent) => (
              <TorrentRow
                key={torrent.hash}
                torrent={torrent}
                selected={selectedTorrents.has(torrent.hash)}
                onToggleSelect={toggleSelect}
                onFetchDetail={fetchDetail}
                onTorrentAction={torrentAction}
                onOpenDeleteDrawer={openDeleteDrawer}
              />
            ))}
          </div>

          {useVirtualization && virtualRange.bottomSpacerHeight > 0 && (
            <div style={{ height: virtualRange.bottomSpacerHeight }} />
          )}
        </div>
      )}

      <Drawer
        open={!!detailHash}
        onOpenChange={(open) => {
          if (!open) {
            setDetailHash(null);
            setDetailData(null);
          }
        }}
      >
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle className="text-sm break-all leading-snug">
              {detailHash ? torrentNameByHash.get(detailHash) || 'Torrent Details' : 'Torrent Details'}
            </DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 max-h-[70vh] overflow-y-auto space-y-4">
            {detailLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : detailData ? (
              <>
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">General</h3>
                  <div className="rounded-lg border divide-y">
                    <DetailRow label="Save Path" value={String(detailData.properties.save_path || '-')} />
                    <DetailRow label="Total Size" value={formatBytes(Number(detailData.properties.total_size) || 0)} />
                    <DetailRow label="Downloaded" value={formatBytes(Number(detailData.properties.total_downloaded) || 0)} />
                    <DetailRow label="Uploaded" value={formatBytes(Number(detailData.properties.total_uploaded) || 0)} />
                    <DetailRow label="Ratio" value={Number(detailData.properties.share_ratio || 0).toFixed(2)} />
                    <DetailRow label="Seeds" value={`${detailData.properties.seeds} (${detailData.properties.seeds_total} total)`} />
                    <DetailRow label="Peers" value={`${detailData.properties.peers} (${detailData.properties.peers_total} total)`} />
                    <DetailRow label="Connections" value={String(detailData.properties.nb_connections || 0)} />
                    {Number(detailData.properties.addition_date) > 0 && (
                      <DetailRow label="Added" value={new Date(Number(detailData.properties.addition_date) * 1000).toLocaleDateString()} />
                    )}
                    {Number(detailData.properties.completion_date) > 0 && (
                      <DetailRow label="Completed" value={new Date(Number(detailData.properties.completion_date) * 1000).toLocaleDateString()} />
                    )}
                  </div>
                </div>

                {detailData.files.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Files ({detailData.files.length})
                    </h3>
                    <div className="space-y-1.5">
                      {detailData.files.map((file) => (
                        <div key={file.index} className="rounded-lg bg-muted/40 p-2.5 space-y-1">
                          <p className="text-xs font-medium break-all leading-snug">{file.name}</p>
                          <div className="flex items-center gap-2">
                            <Progress value={file.progress * 100} className="h-1 flex-1" />
                            <span className="text-[10px] text-muted-foreground shrink-0">
                              {(file.progress * 100).toFixed(0)}%
                            </span>
                          </div>
                          <p className="text-[10px] text-muted-foreground">{formatBytes(file.size)}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {detailData.trackers.length > 0 && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">
                      Trackers ({detailData.trackers.filter((t) => t.url.startsWith('http')).length})
                    </h3>
                    <div className="rounded-lg border divide-y">
                      {detailData.trackers
                        .filter((t) => t.url.startsWith('http'))
                        .map((tracker, i) => (
                          <div key={i} className="px-3 py-2 space-y-0.5">
                            <p className="text-xs break-all">{tracker.url}</p>
                            <p className="text-[10px] text-muted-foreground">
                              Seeds: {tracker.num_seeds} &middot; Peers: {tracker.num_leeches}
                              {tracker.msg && ` &middot; ${tracker.msg}`}
                            </p>
                          </div>
                        ))}
                    </div>
                  </div>
                )}
              </>
            ) : null}
          </div>
        </DrawerContent>
      </Drawer>

      <Drawer open={deleteDrawer.open} onOpenChange={(open) => !open && setDeleteDrawer({ ...deleteDrawer, open: false })}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Delete Torrent</DrawerTitle>
            <DrawerDescription>
              Are you sure you want to delete &ldquo;{deleteDrawer.name}&rdquo;?
            </DrawerDescription>
          </DrawerHeader>

          <div className="px-4 space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteDrawer.deleteFiles}
                onChange={(e) => setDeleteDrawer({ ...deleteDrawer, deleteFiles: e.target.checked })}
                className="rounded border-border"
              />
              <span className="text-sm">Also delete downloaded files</span>
            </label>
            {deleteDrawer.deleteFiles && (
              <p className="text-xs text-destructive">
                Warning: This will permanently delete the downloaded files from disk.
              </p>
            )}
          </div>

          <DrawerFooter>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting} className="w-full">
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-xs text-right max-w-[60%] break-words">{value}</span>
    </div>
  );
}
