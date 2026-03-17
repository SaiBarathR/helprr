'use client';

import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
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
  FolderOpen,
  Settings,
  Gauge,
  Copy,
  CheckCircle2,
  RotateCw,
  Megaphone,
  Tag,
  Pencil,
} from 'lucide-react';
import type {
  QBittorrentTorrent,
  QBittorrentSummaryResponse,
  QBittorrentTransferInfo,
} from '@/types';
import type { TorrentFile, TorrentTracker } from '@/lib/qbittorrent-client';

const TORRENT_ROW_HEIGHT = 160;

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

function formatSeedingTime(seconds: number): string {
  if (seconds <= 0) return '-';
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const parts: string[] = [];
  if (d > 0) parts.push(`${d}d`);
  if (h > 0) parts.push(`${h}h`);
  if (m > 0 || parts.length === 0) parts.push(`${m}m`);
  return parts.join(' ');
}

function formatSpeedLimit(bytesPerSec: number): string {
  if (bytesPerSec <= 0) return 'Unlimited';
  return formatSpeed(bytesPerSec);
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
    && a.ratio === b.ratio
    && a.downloaded === b.downloaded
    && a.uploaded === b.uploaded
    && a.amount_left === b.amount_left
    && a.dl_limit === b.dl_limit
    && a.up_limit === b.up_limit
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

// --- SpeedLimitInput component ---

function SpeedLimitInput({
  label,
  currentLimit,
  onSave,
}: {
  label: string;
  currentLimit: number;
  onSave: (limitBytesPerSec: number) => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [unit, setUnit] = useState<'KB/s' | 'MB/s'>('MB/s');
  const [saving, setSaving] = useState(false);

  const startEditing = () => {
    if (currentLimit > 0) {
      const mbVal = currentLimit / (1024 * 1024);
      if (mbVal >= 1) {
        setValue(mbVal.toFixed(1).replace(/\.0$/, ''));
        setUnit('MB/s');
      } else {
        setValue((currentLimit / 1024).toFixed(0));
        setUnit('KB/s');
      }
    } else {
      setValue('');
      setUnit('MB/s');
    }
    setEditing(true);
  };

  const handleSave = async () => {
    const numVal = parseFloat(value);
    if (isNaN(numVal) || numVal < 0) {
      toast.error('Invalid speed value');
      return;
    }
    setSaving(true);
    const bytesPerSec = unit === 'MB/s' ? numVal * 1024 * 1024 : numVal * 1024;
    try {
      await onSave(Math.round(bytesPerSec));
      setEditing(false);
      toast.success(`${label} updated`);
    } catch {
      toast.error(`Failed to set ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlimited = async () => {
    setSaving(true);
    try {
      await onSave(0);
      setEditing(false);
      toast.success(`${label} set to unlimited`);
    } catch {
      toast.error(`Failed to set ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        className="flex items-center justify-between px-3 py-2 w-full text-left"
        onClick={startEditing}
      >
        <span className="text-xs text-muted-foreground">{label}</span>
        <span className="text-xs">{formatSpeedLimit(currentLimit)}</span>
      </button>
    );
  }

  return (
    <div className="px-3 py-2 space-y-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-2">
        <Input
          type="number"
          min="0"
          step="0.1"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="0"
          className="h-8 text-xs flex-1"
          autoFocus
        />
        <select
          value={unit}
          onChange={(e) => setUnit(e.target.value as 'KB/s' | 'MB/s')}
          className="h-8 text-xs rounded-md border bg-background px-2"
        >
          <option value="KB/s">KB/s</option>
          <option value="MB/s">MB/s</option>
        </select>
      </div>
      <div className="flex gap-2">
        <Button size="sm" className="h-7 text-xs flex-1" onClick={handleSave} disabled={saving}>
          {saving ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Save'}
        </Button>
        <Button size="sm" variant="outline" className="h-7 text-xs flex-1" onClick={handleUnlimited} disabled={saving}>
          Unlimited
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setEditing(false)} disabled={saving}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

// --- TorrentRow component ---

interface TorrentRowProps {
  torrent: QBittorrentTorrent;
  selected: boolean;
  onToggleSelect: (hash: string) => void;
  onFetchDetail: (hash: string) => void;
  onTorrentAction: (hash: string, action: string, extra?: Record<string, unknown>) => void;
  onOpenDeleteDrawer: (hash: string, name: string, deleteFiles: boolean) => void;
  onOpenCategoryDrawer: (hash: string) => void;
  onOpenRenameDrawer: (hash: string, name: string) => void;
}

const TorrentRow = memo(function TorrentRow({
  torrent,
  selected,
  onToggleSelect,
  onFetchDetail,
  onTorrentAction,
  onOpenDeleteDrawer,
  onOpenCategoryDrawer,
  onOpenRenameDrawer,
}: TorrentRowProps) {
  const hasSpeedLimit = torrent.dl_limit > 0 || torrent.up_limit > 0;

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
                <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'recheck')}>
                  <CheckCircle2 className="mr-2 h-4 w-4" /> Recheck
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onTorrentAction(torrent.hash, 'reannounce')}>
                  <Megaphone className="mr-2 h-4 w-4" /> Reannounce
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenCategoryDrawer(torrent.hash)}>
                  <Tag className="mr-2 h-4 w-4" /> Set Category
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onOpenRenameDrawer(torrent.hash, torrent.name)}>
                  <Pencil className="mr-2 h-4 w-4" /> Rename
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
            {hasSpeedLimit && (
              <Gauge className="h-3 w-3 text-yellow-500" />
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

          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-1.5 text-[11px] text-muted-foreground">
            <span>Seeds: {torrent.num_seeds}</span>
            <span>Peers: {torrent.num_leechs}</span>
            <span>Ratio: {(torrent.ratio ?? 0).toFixed(2)}</span>
          </div>
          <div className="flex items-center flex-wrap gap-x-3 gap-y-0.5 mt-0.5 text-[11px] text-muted-foreground">
            <span>DL: {formatBytes(torrent.downloaded ?? 0)}</span>
            <span>UL: {formatBytes(torrent.uploaded ?? 0)}</span>
            {torrent.progress < 1 && torrent.amount_left > 0 && (
              <span>Rem: {formatBytes(torrent.amount_left)}</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}, (prevProps, nextProps) => prevProps.selected === nextProps.selected && prevProps.torrent === nextProps.torrent);

// --- Main page ---

export default function TorrentsPage() {
  const router = useRouter();
  const [torrents, setTorrents] = useState<QBittorrentTorrent[]>([]);
  const [transferInfo, setTransferInfo] = useState<QBittorrentTransferInfo | null>(null);
  const [speedLimitsMode, setSpeedLimitsMode] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());
  const [listOffsetTop, setListOffsetTop] = useState(0);

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

  // Settings drawer
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [globalLimits, setGlobalLimits] = useState<{ downloadLimit: number; uploadLimit: number; speedLimitsMode: number } | null>(null);
  const [globalLimitsLoading, setGlobalLimitsLoading] = useState(false);

  // Category drawer
  const [categoryDrawer, setCategoryDrawer] = useState<{ open: boolean; hash: string }>({ open: false, hash: '' });
  const [categories, setCategories] = useState<Record<string, { name: string; savePath: string }>>({});
  const [categoriesLoading, setCategoriesLoading] = useState(false);

  // Rename drawer
  const [renameDrawer, setRenameDrawer] = useState<{ open: boolean; hash: string; name: string }>({ open: false, hash: '', name: '' });
  const [renameValue, setRenameValue] = useState('');
  const [renaming, setRenaming] = useState(false);

  // Bulk speed limit drawer
  const [bulkSpeedDrawer, setBulkSpeedDrawer] = useState(false);

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
      setSpeedLimitsMode(data.speedLimitsMode ?? 0);
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

  const fetchGlobalLimits = useCallback(async () => {
    setGlobalLimitsLoading(true);
    try {
      const res = await fetch('/api/qbittorrent/transfer/limits');
      if (res.ok) {
        setGlobalLimits(await res.json());
      }
    } catch {
      toast.error('Failed to load global limits');
    } finally {
      setGlobalLimitsLoading(false);
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

  useEffect(() => {
    const list = listRef.current;
    if (!list) return;

    const measure = () => {
      const rect = list.getBoundingClientRect();
      setListOffsetTop(rect.top + window.scrollY);
    };
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(list);
    window.addEventListener('resize', measure);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [selectedTorrents.size, loading, error, torrents.length, search]);

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
        recheck: 'Rechecking',
        reannounce: 'Reannounced',
        setDownloadLimit: 'Download limit set',
        setUploadLimit: 'Upload limit set',
        toggleSequentialDownload: 'Sequential download toggled',
        toggleFirstLastPiecePrio: 'First/last piece priority toggled',
        setCategory: 'Category set',
        setAutoManagement: 'Auto management toggled',
        rename: 'Renamed',
      };
      toast.success(successMessage[action] ?? 'Action successful');
      setTimeout(() => {
        void fetchSummary();
      }, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  }, [fetchSummary]);

  const bulkAction = useCallback(async (action: string, extra?: Record<string, unknown>) => {
    if (selectedTorrents.size === 0) return;
    const hashes = Array.from(selectedTorrents).join('|');
    await torrentAction(hashes, action, extra);
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

  const openCategoryDrawer = useCallback(async (hash: string) => {
    setCategoryDrawer({ open: true, hash });
    setCategoriesLoading(true);
    try {
      // Fetch categories via a dedicated endpoint call
      const res = await fetch('/api/qbittorrent/categories');
      if (res.ok) {
        setCategories(await res.json());
      }
    } catch {
      // Fallback: extract unique categories from loaded torrents
      const cats: Record<string, { name: string; savePath: string }> = {};
      torrents.forEach((t) => {
        if (t.category) cats[t.category] = { name: t.category, savePath: '' };
      });
      setCategories(cats);
    } finally {
      setCategoriesLoading(false);
    }
  }, [torrents]);

  const openRenameDrawer = useCallback((hash: string, name: string) => {
    setRenameDrawer({ open: true, hash, name });
    setRenameValue(name);
  }, []);

  const handleRename = useCallback(async () => {
    if (!renameValue.trim()) return;
    setRenaming(true);
    try {
      await torrentAction(renameDrawer.hash, 'rename', { name: renameValue.trim() });
      setRenameDrawer({ open: false, hash: '', name: '' });
    } catch {
      // Error handled in torrentAction
    } finally {
      setRenaming(false);
    }
  }, [renameDrawer.hash, renameValue, torrentAction]);

  const toggleAltSpeedMode = useCallback(async () => {
    try {
      const res = await fetch('/api/qbittorrent/transfer/limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggleSpeedLimitsMode' }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Alternative speed mode toggled');
      setTimeout(() => void fetchSummary(), 300);
    } catch {
      toast.error('Failed to toggle speed mode');
    }
  }, [fetchSummary]);

  const filteredTorrents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return torrents;
    return torrents.filter((torrent) => torrent.name.toLowerCase().includes(q));
  }, [search, torrents]);

  const useVirtualization = !loading && filteredTorrents.length > 0;
  const virtualizer = useWindowVirtualizer({
    count: filteredTorrents.length,
    estimateSize: () => TORRENT_ROW_HEIGHT,
    enabled: useVirtualization,
    overscan: 8,
    scrollMargin: listOffsetTop,
  });

  const virtualRows = virtualizer.getVirtualItems();
  const firstVirtualRow = virtualRows[0];
  const lastVirtualRow = virtualRows[virtualRows.length - 1];
  const startIndex = firstVirtualRow?.index ?? 0;
  const endIndex = (lastVirtualRow?.index ?? 0) + 1;

  const visibleTorrents = useMemo(() => {
    return filteredTorrents.slice(startIndex, endIndex);
  }, [endIndex, filteredTorrents, startIndex]);

  const topSpacerHeight = firstVirtualRow ? Math.max(0, firstVirtualRow.start - listOffsetTop) : 0;
  const bottomSpacerHeight = lastVirtualRow
    ? Math.max(0, virtualizer.getTotalSize() - (lastVirtualRow.end - listOffsetTop))
    : 0;

  const torrentByHash = useMemo(
    () => new Map(torrents.map((torrent) => [torrent.hash, torrent])),
    [torrents]
  );

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

  // Get detail torrent data from the list for session stats / magnet
  const detailTorrent = detailHash ? torrentByHash.get(detailHash) : null;

  return (
    <div className="space-y-3">
      <div className="sticky z-30 -mx-4 px-4 pt-1 pb-2 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 md:-mx-6 md:px-6 space-y-2" style={{ top: 'var(--header-height, 0px)' }}>
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

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className={`p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg transition-colors ${
                  speedLimitsMode === 1
                    ? 'bg-yellow-500/20 text-yellow-500 hover:bg-yellow-500/30'
                    : 'hover:bg-accent active:bg-accent/80'
                }`}
                onClick={toggleAltSpeedMode}
                aria-label="Alternative Speed Limits"
              >
                <Gauge className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>{speedLimitsMode === 1 ? 'Alt Speed: ON' : 'Alt Speed: OFF'}</TooltipContent>
          </Tooltip>

          <div className="flex-1" />

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                onClick={() => {
                  setSettingsOpen(true);
                  void fetchGlobalLimits();
                }}
                aria-label="Settings"
              >
                <Settings className="h-5 w-5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Settings</TooltipContent>
          </Tooltip>

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

        {transferInfo && (
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
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

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search torrents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
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
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => setBulkSpeedDrawer(true)}
            aria-label="Speed Limits"
          >
            <Gauge className="h-4 w-4" />
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

          {topSpacerHeight > 0 && (
            <div style={{ height: topSpacerHeight }} />
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
                onOpenCategoryDrawer={openCategoryDrawer}
                onOpenRenameDrawer={openRenameDrawer}
              />
            ))}
          </div>

          {bottomSpacerHeight > 0 && (
            <div style={{ height: bottomSpacerHeight }} />
          )}
        </div>
      )}

      {/* Detail Drawer */}
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
                {/* Transfer */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transfer</h3>
                  <div className="rounded-lg border divide-y">
                    <DetailRow label="Total Size" value={formatBytes(Number(detailData.properties.total_size) || 0)} />
                    <DetailRow label="Downloaded" value={formatBytes(Number(detailData.properties.total_downloaded) || 0)} />
                    <DetailRow label="Uploaded" value={formatBytes(Number(detailData.properties.total_uploaded) || 0)} />
                    {detailTorrent && detailTorrent.progress < 1 && (
                      <DetailRow label="Remaining" value={formatBytes(detailTorrent.amount_left || 0)} />
                    )}
                    <DetailRow label="Ratio" value={Number(detailData.properties.share_ratio || 0).toFixed(2)} />
                    <DetailRow label="Availability" value={(detailTorrent?.availability ?? 0).toFixed(2)} />
                    {Number(detailData.properties.dl_speed) > 0 && (
                      <DetailRow label="DL Speed" value={formatSpeed(Number(detailData.properties.dl_speed))} />
                    )}
                    {Number(detailData.properties.up_speed) > 0 && (
                      <DetailRow label="UL Speed" value={formatSpeed(Number(detailData.properties.up_speed))} />
                    )}
                  </div>
                </div>

                {/* Session Stats */}
                {detailTorrent && (detailTorrent.downloaded_session > 0 || detailTorrent.uploaded_session > 0) && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Session Stats</h3>
                    <div className="rounded-lg border divide-y">
                      <DetailRow label="Session Downloaded" value={formatBytes(detailTorrent.downloaded_session)} />
                      <DetailRow label="Session Uploaded" value={formatBytes(detailTorrent.uploaded_session)} />
                    </div>
                  </div>
                )}

                {/* Speed Limits */}
                {detailHash && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Speed Limits</h3>
                    <div className="rounded-lg border divide-y">
                      <SpeedLimitInput
                        label="Download Limit"
                        currentLimit={Number(detailData.properties.dl_limit) || 0}
                        onSave={async (limit) => {
                          await torrentAction(detailHash, 'setDownloadLimit', { limit });
                          // Refresh detail
                          void fetchDetail(detailHash);
                        }}
                      />
                      <SpeedLimitInput
                        label="Upload Limit"
                        currentLimit={Number(detailData.properties.up_limit) || 0}
                        onSave={async (limit) => {
                          await torrentAction(detailHash, 'setUploadLimit', { limit });
                          void fetchDetail(detailHash);
                        }}
                      />
                    </div>
                  </div>
                )}

                {/* Timing */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Timing</h3>
                  <div className="rounded-lg border divide-y">
                    {Number(detailData.properties.addition_date) > 0 && (
                      <DetailRow label="Added" value={new Date(Number(detailData.properties.addition_date) * 1000).toLocaleString()} />
                    )}
                    {Number(detailData.properties.completion_date) > 0 && (
                      <DetailRow label="Completed" value={new Date(Number(detailData.properties.completion_date) * 1000).toLocaleString()} />
                    )}
                    <DetailRow label="Seeding Time" value={formatSeedingTime(Number(detailData.properties.seeding_time) || 0)} />
                    <DetailRow label="Time Elapsed" value={formatSeedingTime(Number(detailData.properties.time_elapsed) || 0)} />
                    {detailTorrent && detailTorrent.eta > 0 && detailTorrent.eta < 8640000 && (
                      <DetailRow label="ETA" value={formatEta(detailTorrent.eta)} />
                    )}
                  </div>
                </div>

                {/* Options */}
                {detailHash && detailTorrent && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Options</h3>
                    <div className="rounded-lg border divide-y">
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-muted-foreground">Sequential Download</span>
                        <Switch
                          checked={detailTorrent.seq_dl}
                          onCheckedChange={() => {
                            void torrentAction(detailHash, 'toggleSequentialDownload');
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-muted-foreground">First/Last Piece Priority</span>
                        <Switch
                          checked={detailTorrent.f_l_piece_prio}
                          onCheckedChange={() => {
                            void torrentAction(detailHash, 'toggleFirstLastPiecePrio');
                          }}
                        />
                      </div>
                      <div className="flex items-center justify-between px-3 py-2">
                        <span className="text-xs text-muted-foreground">Auto Torrent Management</span>
                        <Switch
                          checked={detailTorrent.auto_tmm}
                          onCheckedChange={(checked) => {
                            void torrentAction(detailHash, 'setAutoManagement', { enable: checked });
                          }}
                        />
                      </div>
                    </div>
                  </div>
                )}

                {/* Network */}
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Network</h3>
                  <div className="rounded-lg border divide-y">
                    <DetailRow label="Seeds" value={`${detailData.properties.seeds} (${detailData.properties.seeds_total} total)`} />
                    <DetailRow label="Peers" value={`${detailData.properties.peers} (${detailData.properties.peers_total} total)`} />
                    <DetailRow label="Connections" value={String(detailData.properties.nb_connections || 0)} />
                    <DetailRow label="Wasted" value={formatBytes(Number(detailData.properties.total_wasted) || 0)} />
                    <DetailRow label="Save Path" value={String(detailData.properties.save_path || '-')} />
                  </div>
                </div>

                {/* Magnet Link */}
                {detailTorrent?.magnet_uri && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Magnet Link</h3>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full text-xs"
                      onClick={() => {
                        navigator.clipboard.writeText(detailTorrent.magnet_uri).then(
                          () => toast.success('Magnet URI copied'),
                          () => toast.error('Failed to copy')
                        );
                      }}
                    >
                      <Copy className="mr-2 h-3.5 w-3.5" />
                      Copy Magnet URI
                    </Button>
                  </div>
                )}

                {/* Files */}
                {detailData.files.length > 0 && (
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                        Files ({detailData.files.length})
                      </h3>
                      <button
                        className="flex items-center gap-1.5 text-xs text-primary hover:underline"
                        onClick={() => {
                          const name = detailHash ? torrentNameByHash.get(detailHash) || '' : '';
                          setDetailHash(null);
                          setDetailData(null);
                          router.push(`/torrents/${detailHash}/files?name=${encodeURIComponent(name)}`);
                        }}
                      >
                        <FolderOpen className="h-3.5 w-3.5" />
                        Manage Files
                      </button>
                    </div>
                    <div className="space-y-1.5">
                      {detailData.files.slice(0, 5).map((file) => (
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
                      {detailData.files.length > 5 && (
                        <p className="text-[10px] text-muted-foreground text-center py-1">
                          +{detailData.files.length - 5} more files
                        </p>
                      )}
                    </div>
                  </div>
                )}

                {/* Trackers */}
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

      {/* Delete Drawer */}
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

      {/* Global Settings Drawer */}
      <Drawer open={settingsOpen} onOpenChange={setSettingsOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>qBittorrent Settings</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 max-h-[70vh] overflow-y-auto space-y-4">
            {globalLimitsLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : globalLimits ? (
              <>
                <div>
                  <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Speed Limits</h3>
                  <div className="rounded-lg border divide-y">
                    <SpeedLimitInput
                      label="Global Download Limit"
                      currentLimit={globalLimits.downloadLimit}
                      onSave={async (limit) => {
                        await fetch('/api/qbittorrent/transfer/limits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'setDownloadLimit', limit }),
                        });
                        void fetchGlobalLimits();
                      }}
                    />
                    <SpeedLimitInput
                      label="Global Upload Limit"
                      currentLimit={globalLimits.uploadLimit}
                      onSave={async (limit) => {
                        await fetch('/api/qbittorrent/transfer/limits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'setUploadLimit', limit }),
                        });
                        void fetchGlobalLimits();
                      }}
                    />
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-muted-foreground">Alternative Speed Limits</span>
                      <Switch
                        checked={globalLimits.speedLimitsMode === 1}
                        onCheckedChange={async () => {
                          await toggleAltSpeedMode();
                          void fetchGlobalLimits();
                        }}
                      />
                    </div>
                  </div>
                </div>

                {transferInfo && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Transfer Stats</h3>
                    <div className="rounded-lg border divide-y">
                      <DetailRow label="Session Downloaded" value={formatBytes(transferInfo.dl_info_data)} />
                      <DetailRow label="Session Uploaded" value={formatBytes(transferInfo.up_info_data)} />
                      <DetailRow label="DHT Nodes" value={String(transferInfo.dht_nodes)} />
                      <DetailRow label="Connection Status" value={transferInfo.connection_status} />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <p className="text-sm text-muted-foreground text-center py-4">Failed to load settings.</p>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Category Picker Drawer */}
      <Drawer open={categoryDrawer.open} onOpenChange={(open) => !open && setCategoryDrawer({ open: false, hash: '' })}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Set Category</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 max-h-[60vh] overflow-y-auto">
            {categoriesLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="rounded-lg border divide-y">
                <button
                  className="flex items-center w-full px-3 py-3 text-sm hover:bg-accent transition-colors"
                  onClick={async () => {
                    await torrentAction(categoryDrawer.hash, 'setCategory', { category: '' });
                    setCategoryDrawer({ open: false, hash: '' });
                  }}
                >
                  <span className="text-muted-foreground italic">None</span>
                </button>
                {Object.entries(categories).map(([key, cat]) => (
                  <button
                    key={key}
                    className="flex items-center justify-between w-full px-3 py-3 text-sm hover:bg-accent transition-colors"
                    onClick={async () => {
                      await torrentAction(categoryDrawer.hash, 'setCategory', { category: cat.name });
                      setCategoryDrawer({ open: false, hash: '' });
                    }}
                  >
                    <span>{cat.name}</span>
                    {cat.savePath && (
                      <span className="text-[10px] text-muted-foreground truncate max-w-[50%]">{cat.savePath}</span>
                    )}
                  </button>
                ))}
                {Object.keys(categories).length === 0 && (
                  <p className="px-3 py-3 text-sm text-muted-foreground text-center">No categories found</p>
                )}
              </div>
            )}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Rename Drawer */}
      <Drawer open={renameDrawer.open} onOpenChange={(open) => !open && setRenameDrawer({ open: false, hash: '', name: '' })}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Rename Torrent</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2">
            <Input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              placeholder="Torrent name"
              autoFocus
            />
          </div>
          <DrawerFooter>
            <Button onClick={handleRename} disabled={renaming || !renameValue.trim()} className="w-full">
              {renaming ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Renaming...
                </>
              ) : (
                'Rename'
              )}
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Bulk Speed Limit Drawer */}
      <Drawer open={bulkSpeedDrawer} onOpenChange={setBulkSpeedDrawer}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Set Speed Limits ({selectedTorrents.size} torrents)</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-6 space-y-1">
            <div className="rounded-lg border divide-y">
              <SpeedLimitInput
                label="Download Limit"
                currentLimit={0}
                onSave={async (limit) => {
                  await bulkAction('setDownloadLimit', { limit });
                  setBulkSpeedDrawer(false);
                }}
              />
              <SpeedLimitInput
                label="Upload Limit"
                currentLimit={0}
                onSave={async (limit) => {
                  await bulkAction('setUploadLimit', { limit });
                  setBulkSpeedDrawer(false);
                }}
              />
            </div>
          </div>
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
