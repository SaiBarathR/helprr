'use client';

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useWindowVirtualizer } from '@tanstack/react-virtual';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { SearchInput } from '@/components/media/search-input';
import { PullToRefresh } from '@/components/ui/pull-to-refresh';
import { useRefreshAction } from '@/lib/hooks/use-refresh-action';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { getRefreshIntervalMs } from '@/lib/client-refresh-settings';
import { reportBulkTorrent } from '@/lib/bulk-fan-out';
import { useQuery } from '@tanstack/react-query';
import { backoffRefetchInterval } from '@/lib/query-fetch';
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
import { ListSkeleton } from '@/components/ui/list-skeleton';
import { SwipeRow } from '@/components/ui/swipe-row';
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
  ArrowUpDown,
  RefreshCw,
  Search,
  Filter,
  FolderOpen,
  Settings,
  Gauge,
  Copy,
  CheckCircle2,
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
import {
  useUIStore,
  type TorrentsFilterPreference as FilterType,
  type TorrentsSortKeyPreference as SortKey,
} from '@/lib/store';
import { useCan } from '@/components/permission-provider';
import { useBadgeActions } from '@/components/layout/badge-provider';

const TORRENT_ROW_HEIGHT = 160;
// Table rows are a fixed h-14 (56px, border included via border-box) so the
// virtualizer estimate is exact.
const TABLE_ROW_HEIGHT = 56;

const TORRENT_ACTION_MESSAGES: Record<string, { single: string; bulk?: string }> = {
  start: { single: 'Started', bulk: 'start' },
  stop: { single: 'Stopped', bulk: 'stop' },
  forceStart: { single: 'Force started', bulk: 'force start' },
  delete: { single: 'Deleted', bulk: 'delete' },
  recheck: { single: 'Rechecking', bulk: 'recheck' },
  reannounce: { single: 'Reannounced', bulk: 'reannounce' },
  setDownloadLimit: { single: 'Download limit set', bulk: 'Set download limit for' },
  setUploadLimit: { single: 'Upload limit set', bulk: 'Set upload limit for' },
  toggleSequentialDownload: { single: 'Sequential download toggled', bulk: 'toggle sequential download for' },
  toggleFirstLastPiecePrio: { single: 'First/last piece priority toggled', bulk: 'toggle first/last piece priority for' },
  setCategory: { single: 'Category set', bulk: 'set category for' },
  setAutoManagement: { single: 'Auto management toggled', bulk: 'toggle auto management for' },
  rename: { single: 'Renamed', bulk: 'rename' },
};

function torrentActionMessage(action: string, mode: 'single' | 'bulk'): string {
  const message = TORRENT_ACTION_MESSAGES[action];
  if (!message) return mode === 'bulk' ? 'Updated' : 'Action successful';
  return mode === 'bulk' ? message.bulk ?? message.single : message.single;
}

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
    stoppedDL: { label: 'Stopped', variant: 'outline' },
    stoppedUP: { label: 'Stopped', variant: 'outline' },
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

const filterOptions: { value: FilterType; label: string }[] = [
  { value: 'downloading', label: 'Downloading' },
  { value: 'seeding', label: 'Seeding' },
  { value: 'completed', label: 'Completed' },
  { value: 'paused', label: 'Paused' },
  { value: 'active', label: 'Active' },
];

const DOWNLOADING_STATES = new Set([
  'downloading', 'metaDL', 'allocating', 'stalledDL', 'queuedDL', 'checkingDL', 'forcedDL',
]);
const SEEDING_STATES = new Set([
  'uploading', 'stalledUP', 'queuedUP', 'checkingUP', 'forcedUP', 'pausedUP', 'stoppedUP',
]);
// qBittorrent 5.x renamed pausedDL/pausedUP to stoppedDL/stoppedUP.
const PAUSED_STATES = new Set(['pausedDL', 'pausedUP', 'stoppedDL', 'stoppedUP']);

function matchesTorrentFilter(t: QBittorrentTorrent, f: FilterType): boolean {
  switch (f) {
    case 'all': return true;
    case 'downloading': return DOWNLOADING_STATES.has(t.state);
    case 'seeding': return SEEDING_STATES.has(t.state);
    case 'completed': return t.progress >= 1;
    case 'paused': return PAUSED_STATES.has(t.state);
    case 'active': return t.dlspeed > 0 || t.upspeed > 0;
    default: return true;
  }
}

const SORT_OPTIONS: { key: SortKey; label: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'size', label: 'Size' },
  { key: 'progress', label: 'Progress' },
  { key: 'dlspeed', label: 'Download Speed' },
  { key: 'upspeed', label: 'Upload Speed' },
  { key: 'eta', label: 'ETA' },
  { key: 'ratio', label: 'Ratio' },
  { key: 'added_on', label: 'Date Added' },
  { key: 'completion_on', label: 'Date Completed' },
  { key: 'num_seeds', label: 'Seeds' },
  { key: 'num_leechs', label: 'Peers' },
  { key: 'priority', label: 'Priority' },
  { key: 'category', label: 'Category' },
  { key: 'state', label: 'Status' },
  { key: 'uploaded', label: 'Uploaded' },
  { key: 'downloaded', label: 'Downloaded' },
  { key: 'amount_left', label: 'Remaining' },
  { key: 'time_active', label: 'Time Active' },
  { key: 'seeding_time', label: 'Seeding Time' },
];

function compareTorrents(a: QBittorrentTorrent, b: QBittorrentTorrent, key: SortKey): number {
  switch (key) {
    case 'name': return a.name.localeCompare(b.name);
    case 'category': return (a.category || '').localeCompare(b.category || '');
    case 'state': return a.state.localeCompare(b.state);
    case 'size':
    case 'progress':
    case 'dlspeed':
    case 'upspeed':
    case 'eta':
    case 'ratio':
    case 'added_on':
    case 'completion_on':
    case 'num_seeds':
    case 'num_leechs':
    case 'priority':
    case 'uploaded':
    case 'downloaded':
    case 'amount_left':
    case 'time_active':
    case 'seeding_time':
      return a[key] - b[key];
    default: {
      return 0;
    }
  }
}

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
    && a.priority === b.priority
    && a.time_active === b.time_active
    && a.seeding_time === b.seeding_time
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

// Optimistic row patches applied to the touched rows before the POST resolves.
// qBittorrent applies actions ASYNCHRONOUSLY: a poll landing right after the
// POST can still report the pre-action data, so each patch's key field is also
// held as a pending override (see the merge effect) until a poll confirms the
// value actually changed — otherwise the reconcile would revert the row.
const OPTIMISTIC_ROW_PATCHES: Record<
  string,
  (t: QBittorrentTorrent, extra?: Record<string, unknown>) => QBittorrentTorrent
> = {
  start: (t) => ({ ...t, state: t.progress >= 1 ? 'uploading' : 'downloading' }),
  resume: (t) => ({ ...t, state: t.progress >= 1 ? 'uploading' : 'downloading' }),
  forceStart: (t) => ({ ...t, state: t.progress >= 1 ? 'forcedUP' : 'forcedDL' }),
  stop: (t) => ({ ...t, state: t.progress >= 1 ? 'stoppedUP' : 'stoppedDL', dlspeed: 0, upspeed: 0 }),
  pause: (t) => ({ ...t, state: t.progress >= 1 ? 'pausedUP' : 'pausedDL', dlspeed: 0, upspeed: 0 }),
  setCategory: (t, extra) => ({ ...t, category: String(extra?.category ?? '') }),
  rename: (t, extra) => ({ ...t, name: String(extra?.name ?? t.name) }),
};

// The field each action's override guards (the one the reconcile must not revert).
const OPTIMISTIC_OVERRIDE_FIELD: Record<string, 'state' | 'name' | 'category'> = {
  start: 'state',
  resume: 'state',
  forceStart: 'state',
  stop: 'state',
  pause: 'state',
  setCategory: 'category',
  rename: 'name',
};

// How long an optimistic override (or delete tombstone) may outlive polls that
// still report the pre-action data before we give up and accept the server.
const OPTIMISTIC_STATE_TTL_MS = 10_000;

type PendingFieldOverride = {
  field: 'state' | 'name' | 'category';
  value: string;
  prev: string;
  until: number;
};

// --- SpeedLimitInput component ---

function SpeedLimitInput({
  label,
  currentLimit,
  onSave,
}: {
  label: string;
  currentLimit: number;
  // Resolving false means the action layer already surfaced the failure (its
  // own toast) — skip the success toast and keep the editor open. A throw
  // means the failure hasn't been surfaced yet, so toast it here.
  onSave: (limitBytesPerSec: number) => Promise<boolean | void>;
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
      if (await onSave(Math.round(bytesPerSec)) !== false) {
        setEditing(false);
        toast.success(`${label} updated`);
      }
    } catch {
      toast.error(`Failed to set ${label.toLowerCase()}`);
    } finally {
      setSaving(false);
    }
  };

  const handleUnlimited = async () => {
    setSaving(true);
    try {
      if (await onSave(0) !== false) {
        setEditing(false);
        toast.success(`${label} set to unlimited`);
      }
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
        <Select value={unit} onValueChange={(v) => setUnit(v as 'KB/s' | 'MB/s')}>
          <SelectTrigger size="sm" className="text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="KB/s">KB/s</SelectItem>
            <SelectItem value="MB/s">MB/s</SelectItem>
          </SelectContent>
        </Select>
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

// --- Row actions dropdown (shared by card and table rows) ---

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

function TorrentRowActions({
  torrent,
  onTorrentAction,
  onOpenDeleteDrawer,
  onOpenCategoryDrawer,
  onOpenRenameDrawer,
  triggerClassName,
}: Omit<TorrentRowProps, 'selected' | 'onToggleSelect' | 'onFetchDetail'> & { triggerClassName?: string }) {
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  if (!canManageTorrents && !canDeleteTorrents) return null;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className={triggerClassName ?? 'h-7 w-7 shrink-0'}>
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {canManageTorrents && (
          <>
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
          </>
        )}
        {canManageTorrents && canDeleteTorrents && <DropdownMenuSeparator />}
        {canDeleteTorrents && (
          <>
            <DropdownMenuItem onClick={() => onOpenDeleteDrawer(torrent.hash, torrent.name, false)}>
              <Trash2 className="mr-2 h-4 w-4" /> Delete (keep files)
            </DropdownMenuItem>
            <DropdownMenuItem
              className="text-destructive"
              onClick={() => onOpenDeleteDrawer(torrent.hash, torrent.name, true)}
            >
              <Trash2 className="mr-2 h-4 w-4" /> Delete with files
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// --- TorrentRow component (card view) ---

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
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  const stopped = PAUSED_STATES.has(torrent.state);

  return (
    <SwipeRow
      contentClassName="bg-card"
      leftAction={canManageTorrents ? {
        label: stopped ? 'Start' : 'Stop',
        icon: stopped ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />,
        className: 'bg-primary text-primary-foreground',
        onAction: () => onTorrentAction(torrent.hash, stopped ? 'start' : 'stop'),
      } : undefined}
      rightAction={canDeleteTorrents ? {
        label: 'Delete',
        icon: <Trash2 className="h-4 w-4" />,
        className: 'bg-destructive text-destructive-foreground',
        onAction: () => onOpenDeleteDrawer(torrent.hash, torrent.name, false),
      } : undefined}
    >
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
            <TorrentRowActions
              torrent={torrent}
              onTorrentAction={onTorrentAction}
              onOpenDeleteDrawer={onOpenDeleteDrawer}
              onOpenCategoryDrawer={onOpenCategoryDrawer}
              onOpenRenameDrawer={onOpenRenameDrawer}
              triggerClassName="h-7 w-7 shrink-0 -mt-0.5"
            />
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
    </SwipeRow>
  );
}, (prevProps, nextProps) => prevProps.selected === nextProps.selected && prevProps.torrent === nextProps.torrent);

// --- Table view ---

// Shared cell classes so header and rows stay column-aligned. Columns collapse
// progressively on narrower screens; below `sm` the name cell grows a second
// line carrying state/size/speed so the table stays usable on phones.
const TABLE_COL = {
  select: 'w-7 shrink-0 flex items-center justify-center',
  name: 'flex-1 min-w-0',
  size: 'hidden sm:flex w-16 shrink-0 justify-end',
  progress: 'w-24 sm:w-28 shrink-0 flex items-center',
  status: 'hidden sm:flex w-24 shrink-0',
  dlspeed: 'hidden md:flex w-20 shrink-0 justify-end',
  upspeed: 'hidden md:flex w-20 shrink-0 justify-end',
  eta: 'hidden lg:flex w-16 shrink-0 justify-end',
  seeds: 'hidden xl:flex w-12 shrink-0 justify-end',
  peers: 'hidden xl:flex w-12 shrink-0 justify-end',
  ratio: 'hidden xl:flex w-14 shrink-0 justify-end',
  actions: 'w-8 shrink-0 flex items-center justify-center',
} as const;

function SortHeaderButton({
  label,
  columnKey,
  className,
  sortKey,
  sortDir,
  onSort,
}: {
  label: string;
  columnKey: SortKey;
  className: string;
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
}) {
  const active = sortKey === columnKey;
  const Icon = sortDir === 'asc' ? ArrowUp : ArrowDown;
  return (
    <button
      className={`${className} items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground transition-colors`}
      onClick={() => onSort(columnKey)}
    >
      <span className="truncate">{label}</span>
      {active && <Icon className="h-3 w-3 shrink-0" />}
    </button>
  );
}

function TorrentTableHeader({
  sortKey,
  sortDir,
  onSort,
  allSelected,
  onToggleAll,
}: {
  sortKey: SortKey;
  sortDir: 'asc' | 'desc';
  onSort: (key: SortKey) => void;
  allSelected: boolean;
  onToggleAll: () => void;
}) {
  const sortProps = { sortKey, sortDir, onSort };
  return (
    <div className="flex items-center gap-2 h-9 px-2 sm:px-3 border-b border-border/50">
      <div className={TABLE_COL.select}>
        <input
          type="checkbox"
          checked={allSelected}
          onChange={onToggleAll}
          className="rounded border-border"
          aria-label="Select all"
        />
      </div>
      <SortHeaderButton label="Name" columnKey="name" className={`${TABLE_COL.name} flex text-left`} {...sortProps} />
      <SortHeaderButton label="Status" columnKey="state" className={TABLE_COL.status} {...sortProps} />
      <SortHeaderButton label="Progress" columnKey="progress" className={TABLE_COL.progress} {...sortProps} />
      <SortHeaderButton label="Size" columnKey="size" className={TABLE_COL.size} {...sortProps} />
      <SortHeaderButton label="DL" columnKey="dlspeed" className={TABLE_COL.dlspeed} {...sortProps} />
      <SortHeaderButton label="UL" columnKey="upspeed" className={TABLE_COL.upspeed} {...sortProps} />
      <SortHeaderButton label="ETA" columnKey="eta" className={TABLE_COL.eta} {...sortProps} />
      <SortHeaderButton label="Seeds" columnKey="num_seeds" className={TABLE_COL.seeds} {...sortProps} />
      <SortHeaderButton label="Peers" columnKey="num_leechs" className={TABLE_COL.peers} {...sortProps} />
      <SortHeaderButton label="Ratio" columnKey="ratio" className={TABLE_COL.ratio} {...sortProps} />
      <div className={TABLE_COL.actions} />
    </div>
  );
}

const TorrentTableRow = memo(function TorrentTableRow({
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
    <div className="flex items-center gap-2 h-14 px-2 sm:px-3">
      <div className={TABLE_COL.select}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(torrent.hash)}
          className="rounded border-border"
          aria-label={`Select ${torrent.name}`}
        />
      </div>
      <div className={TABLE_COL.name}>
        <div className="flex items-center gap-1.5 min-w-0">
          <button
            className="text-sm font-medium truncate text-left hover:underline min-w-0"
            title={torrent.name}
            onClick={() => onFetchDetail(torrent.hash)}
          >
            {torrent.name}
          </button>
          {torrent.category && (
            <Badge variant="outline" className="hidden md:inline-flex text-[10px] px-1.5 py-0 shrink-0 max-w-[120px] truncate">
              {torrent.category}
            </Badge>
          )}
          {hasSpeedLimit && <Gauge className="hidden md:block h-3 w-3 text-yellow-500 shrink-0" />}
        </div>
        <div className="sm:hidden flex items-center gap-1.5 mt-0.5 text-[10px] text-muted-foreground">
          {getStateBadge(torrent.state)}
          <span>{formatBytes(torrent.size)}</span>
          {torrent.dlspeed > 0 && (
            <span className="text-green-500">
              <ArrowDown className="inline h-2.5 w-2.5" /> {formatSpeed(torrent.dlspeed)}
            </span>
          )}
          {torrent.upspeed > 0 && (
            <span className="text-blue-500">
              <ArrowUp className="inline h-2.5 w-2.5" /> {formatSpeed(torrent.upspeed)}
            </span>
          )}
        </div>
      </div>
      <div className={TABLE_COL.status}>{getStateBadge(torrent.state)}</div>
      <div className={`${TABLE_COL.progress} gap-1.5`}>
        <Progress value={torrent.progress * 100} className="h-1 flex-1" />
        <span className="text-[10px] text-muted-foreground w-8 text-right shrink-0">
          {(torrent.progress * 100).toFixed(0)}%
        </span>
      </div>
      <div className={`${TABLE_COL.size} text-xs text-muted-foreground`}>{formatBytes(torrent.size)}</div>
      <div className={`${TABLE_COL.dlspeed} text-xs`}>
        {torrent.dlspeed > 0
          ? <span className="text-green-500">{formatSpeed(torrent.dlspeed)}</span>
          : <span className="text-muted-foreground">&mdash;</span>}
      </div>
      <div className={`${TABLE_COL.upspeed} text-xs`}>
        {torrent.upspeed > 0
          ? <span className="text-blue-500">{formatSpeed(torrent.upspeed)}</span>
          : <span className="text-muted-foreground">&mdash;</span>}
      </div>
      <div className={`${TABLE_COL.eta} text-xs text-muted-foreground`}>
        {torrent.eta > 0 && torrent.eta < 8640000 ? formatEta(torrent.eta) : '—'}
      </div>
      <div className={`${TABLE_COL.seeds} text-xs text-muted-foreground`}>{torrent.num_seeds}</div>
      <div className={`${TABLE_COL.peers} text-xs text-muted-foreground`}>{torrent.num_leechs}</div>
      <div className={`${TABLE_COL.ratio} text-xs text-muted-foreground`}>{(torrent.ratio ?? 0).toFixed(2)}</div>
      <div className={TABLE_COL.actions}>
        <TorrentRowActions
          torrent={torrent}
          onTorrentAction={onTorrentAction}
          onOpenDeleteDrawer={onOpenDeleteDrawer}
          onOpenCategoryDrawer={onOpenCategoryDrawer}
          onOpenRenameDrawer={onOpenRenameDrawer}
        />
      </div>
    </div>
  );
}, (prevProps, nextProps) => prevProps.selected === nextProps.selected && prevProps.torrent === nextProps.torrent);

// --- Main page ---

export default function TorrentsPage() {
  const router = useRouter();
  const { adjustBadge } = useBadgeActions();
  const canManageTorrents = useCan('torrents.manage');
  const canDeleteTorrents = useCan('torrents.delete');
  const canBandwidthTorrents = useCan('torrents.bandwidth');
  const canAddTorrents = useCan('torrents.add');
  const hasHydrated = useUIStore((s) => s.hasHydrated);
  const filter = useUIStore((s) => s.torrentsFilter);
  const setFilter = useUIStore((s) => s.setTorrentsFilter);
  const sortKey = useUIStore((s) => s.torrentsSortKey);
  const setSortKey = useUIStore((s) => s.setTorrentsSortKey);
  const sortDir = useUIStore((s) => s.torrentsSortDir);
  const setSortDir = useUIStore((s) => s.setTorrentsSortDir);
  const viewMode = useUIStore((s) => s.torrentsView);
  const setViewMode = useUIStore((s) => s.setTorrentsView);
  const isTableView = viewMode === 'table';
  const [torrents, setTorrents] = useState<QBittorrentTorrent[]>([]);
  const [transferInfo, setTransferInfo] = useState<QBittorrentTransferInfo | null>(null);
  const [speedLimitsMode, setSpeedLimitsMode] = useState(0);
  const [refreshIntervalMs, setRefreshIntervalMs] = useState(5000);
  const [search, setSearch] = useState('');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());
  const [listOffsetTop, setListOffsetTop] = useState(0);

  const [detailHash, setDetailHash] = useState<string | null>(null);
  // Mirrors detailHash so an in-flight detail fetch can tell it was superseded
  // (another torrent opened, or the drawer closed) and drop its response.
  const detailHashRef = useRef<string | null>(null);
  const [detailData, setDetailData] = useState<{
    properties: Record<string, unknown>;
    files: TorrentFile[];
    trackers: TorrentTracker[];
  } | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  useEffect(() => {
    detailHashRef.current = detailHash;
  }, [detailHash]);

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
  // When exactly one filter is active, push it to qBittorrent so the server slims
  // the payload. Multi-select uses OR semantics the qBit `filter` param doesn't
  // support, so we fetch all + filter client-side in that case. The signature is
  // part of the query key so switching filters refetches immediately.
  const filterSignature = filter.length === 1 ? filter[0] : filter.length === 0 ? '__all__' : '__multi__';

  const summaryQuery = useQuery({
    queryKey: ['torrents', 'summary', filterSignature],
    queryFn: async ({ signal }): Promise<QBittorrentSummaryResponse> => {
      const currentFilter = useUIStore.getState().torrentsFilter;
      const params = new URLSearchParams();
      if (currentFilter.length === 1) params.set('filter', currentFilter[0]);
      const qs = params.toString();
      const res = await fetch(qs ? `/api/qbittorrent/summary?${qs}` : '/api/qbittorrent/summary', { signal });
      if (!res.ok) throw new Error('Failed to fetch');
      const data = (await res.json()) as QBittorrentSummaryResponse & { error?: string };
      if (data.error) throw new Error(data.error);
      return data;
    },
    enabled: hasHydrated,
    refetchInterval: backoffRefetchInterval(refreshIntervalMs),
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 0,
  });
  const refetchSummary = summaryQuery.refetch;

  // Optimistic overrides awaiting server confirmation, keyed by hash.
  // qBittorrent applies actions asynchronously, so a poll can still report the
  // pre-action data right after an action; while an override is pending (and
  // unexpired) such a poll must not revert the row. Deletes get tombstones
  // (hash → expiry) that suppress re-insertion until the server stops
  // reporting the torrent.
  const pendingFieldRef = useRef(new Map<string, PendingFieldOverride>());
  const pendingDeleteRef = useRef(new Map<string, number>());
  // Optimistic alt-speed-mode flip awaiting confirmation (same idea, one value).
  const pendingSpeedModeRef = useRef<{ value: number; prev: number; until: number } | null>(null);

  // Mirror of `torrents` so the merge effect and torrentAction can read the
  // committed list without adding it to deps (which would churn row callbacks).
  const torrentsRef = useRef(torrents);
  torrentsRef.current = torrents;

  // Merge new data into local state so polls preserve UI ordering/identity
  // (mergeTorrents reconciles by hash instead of replacing the list wholesale).
  // Reconciliation of pending overrides happens HERE, outside the setTorrents
  // updater: updaters must stay pure (they can re-run), and deleting overrides
  // inside one could clear them before the state is actually committed.
  useEffect(() => {
    const data = summaryQuery.data;
    if (!data) return;
    const now = Date.now();
    let merged = mergeTorrents(torrentsRef.current, data.torrents);

    const tombstones = pendingDeleteRef.current;
    if (tombstones.size > 0) {
      const serverHashes = new Set(data.torrents.map((t) => t.hash));
      for (const [hash, until] of tombstones) {
        // Confirmed (server no longer reports it) or expired.
        if (!serverHashes.has(hash) || now > until) tombstones.delete(hash);
      }
      if (tombstones.size > 0) merged = merged.filter((t) => !tombstones.has(t.hash));
    }

    const pending = pendingFieldRef.current;
    if (pending.size > 0) {
      merged = merged.map((t) => {
        const override = pending.get(t.hash);
        if (!override) return t;
        if (t[override.field] !== override.prev || now > override.until) {
          // Confirmed (field moved off the pre-action value) or expired.
          pending.delete(t.hash);
          return t;
        }
        return { ...t, [override.field]: override.value };
      });
      for (const hash of pending.keys()) {
        if (!merged.some((t) => t.hash === hash)) pending.delete(hash);
      }
    }

    setTorrents(merged);
    setTransferInfo(data.transferInfo);

    const serverMode = data.speedLimitsMode ?? 0;
    const modeOverride = pendingSpeedModeRef.current;
    if (modeOverride && serverMode === modeOverride.prev && now <= modeOverride.until) {
      setSpeedLimitsMode(modeOverride.value);
    } else {
      pendingSpeedModeRef.current = null;
      setSpeedLimitsMode(serverMode);
    }
  }, [summaryQuery.data]);

  // The query is disabled until the store hydrates, so isLoading stays false in
  // that gap — treat it as loading to avoid a brief "No torrents found" flash.
  const loading = !hasHydrated || summaryQuery.isLoading;
  const { refreshing, refresh } = useRefreshAction(refetchSummary);
  const error = summaryQuery.isError
    ? summaryQuery.error instanceof Error
      ? summaryQuery.error.message
      : 'Failed to fetch torrents'
    : null;

  const fetchDetail = useCallback(async (hash: string) => {
    setDetailHash(hash);
    detailHashRef.current = hash;
    setDetailLoading(true);
    setDetailData(null);
    try {
      const res = await fetch(`/api/qbittorrent/${hash}/details`);
      // Superseded (another torrent opened) or drawer closed while in flight:
      // this response no longer owns the drawer state.
      if (detailHashRef.current !== hash) return;
      if (res.ok) {
        setDetailData(await res.json());
      } else {
        toast.error('Failed to load torrent details');
      }
    } catch {
      if (detailHashRef.current === hash) toast.error('Failed to load torrent details');
    } finally {
      if (detailHashRef.current === hash) setDetailLoading(false);
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
    async function loadRefreshInterval() {
      const intervalMs = await getRefreshIntervalMs('torrentsRefreshIntervalSecs', 5);
      setRefreshIntervalMs(intervalMs);
    }
    loadRefreshInterval();
  }, []);

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
    // isTableView: switching views remounts the measured node, so re-attach.
  }, [selectedTorrents.size, loading, error, torrents.length, search, isTableView]);

  const torrentAction = useCallback(async (
    hash: string,
    action: string,
    extra?: Record<string, unknown>,
    opts?: { silent?: boolean },
  ): Promise<boolean> => {
    // Optimistically patch the touched rows so the UI reacts instantly; the
    // patched field is also registered as a pending override (deletes as
    // tombstones) so a poll racing the action can't revert the rows.
    const patchRow = OPTIMISTIC_ROW_PATCHES[action];
    const hashes = new Set(hash.split('|'));
    let snapshot: QBittorrentTorrent[] | null = null;
    if (patchRow || action === 'delete') {
      snapshot = torrentsRef.current;
      const until = Date.now() + OPTIMISTIC_STATE_TTL_MS;
      if (action === 'delete') {
        for (const h of hashes) pendingDeleteRef.current.set(h, until);
      } else {
        const field = OPTIMISTIC_OVERRIDE_FIELD[action];
        if (field) {
          for (const t of snapshot) {
            if (!hashes.has(t.hash)) continue;
            const next = patchRow!(t, extra);
            if (next[field] !== t[field]) {
              pendingFieldRef.current.set(t.hash, { field, value: next[field], prev: t[field], until });
            }
          }
        }
      }
      setTorrents((prev) =>
        action === 'delete'
          ? prev.filter((t) => !hashes.has(t.hash))
          : prev.map((t) => (hashes.has(t.hash) ? patchRow!(t, extra) : t)),
      );
    }
    try {
      const res = await fetch('/api/qbittorrent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, action, ...extra }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || 'Action failed');
      }
      if (!opts?.silent) {
        toast.success(torrentActionMessage(action, 'single'));
      }
      setTimeout(() => {
        void refetchSummary();
      }, 500);
      return true;
    } catch (err) {
      // Roll back only the touched rows: a wholesale snapshot restore would
      // clobber poll updates and other optimistic actions that landed in flight.
      if (snapshot) {
        const snapByHash = new Map(snapshot.map((t) => [t.hash, t]));
        if (action === 'delete') {
          for (const h of hashes) pendingDeleteRef.current.delete(h);
          setTorrents((prev) => {
            const have = new Set(prev.map((t) => t.hash));
            const restored = snapshot!.filter((t) => hashes.has(t.hash) && !have.has(t.hash));
            // Order doesn't matter: the visible list is re-sorted by sortKey.
            return restored.length > 0 ? [...prev, ...restored] : prev;
          });
        } else {
          for (const h of hashes) pendingFieldRef.current.delete(h);
          setTorrents((prev) =>
            prev.map((t) => (hashes.has(t.hash) && snapByHash.has(t.hash) ? snapByHash.get(t.hash)! : t)),
          );
        }
      }
      if (!opts?.silent) toast.error(err instanceof Error ? err.message : 'Action failed');
      return false;
    }
  }, [refetchSummary]);

  const bulkAction = useCallback(async (action: string, extra?: Record<string, unknown>): Promise<boolean> => {
    if (selectedTorrents.size === 0) return false;
    const count = selectedTorrents.size;
    const hashes = Array.from(selectedTorrents).join('|');
    const verb = torrentActionMessage(action, 'bulk');
    const ok = await torrentAction(hashes, action, extra, { silent: true });
    if (ok) {
      reportBulkTorrent(verb, count, 0);
      setSelectedTorrents(new Set());
    } else {
      reportBulkTorrent(verb, 0, count);
    }
    return ok;
  }, [selectedTorrents, torrentAction]);

  const handleDelete = useCallback(async () => {
    setDeleting(true);
    // Capture each removed torrent's badge contribution before the rows vanish:
    // in-flight (progress < 1) counts toward the total, stalled/errored toward
    // attention. deleteDrawer.hash is one hash or several joined with '|'.
    const hashes = new Set(deleteDrawer.hash.split('|'));
    let inFlight = 0;
    let attention = 0;
    for (const torrent of torrents) {
      if (!hashes.has(torrent.hash)) continue;
      // attention is a subset of in-flight, matching the poll's badge definition.
      if (torrent.progress < 1) {
        inFlight++;
        if (torrent.state === 'error' || torrent.state === 'missingFiles' || torrent.state === 'stalledDL') {
          attention++;
        }
      }
    }
    try {
      const ok = await torrentAction(deleteDrawer.hash, 'delete', { deleteFiles: deleteDrawer.deleteFiles });
      // Only adjust the badge / close the drawer when the delete actually succeeded.
      if (ok) {
        if (inFlight || attention) adjustBadge('downloads', -inFlight, -attention);
        setDeleteDrawer({ open: false, hash: '', name: '', deleteFiles: false });
      }
    } finally {
      setDeleting(false);
    }
  }, [deleteDrawer.deleteFiles, deleteDrawer.hash, torrentAction, torrents, adjustBadge]);

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
    // Optimistic flip with a pending override so a racing poll can't bounce the
    // toggle; the captured pre-action value (not a blind re-flip, which could
    // land on the wrong side after a poll repaint) is restored on failure.
    const prev = speedLimitsMode;
    const next = prev === 1 ? 0 : 1;
    pendingSpeedModeRef.current = { value: next, prev, until: Date.now() + OPTIMISTIC_STATE_TTL_MS };
    setSpeedLimitsMode(next);
    try {
      const res = await fetch('/api/qbittorrent/transfer/limits', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggleSpeedLimitsMode' }),
      });
      if (!res.ok) throw new Error('Failed');
      toast.success('Alternative speed mode toggled');
      setTimeout(() => void refetchSummary(), 300);
    } catch {
      pendingSpeedModeRef.current = null;
      setSpeedLimitsMode(prev);
      toast.error('Failed to toggle speed mode');
    }
  }, [refetchSummary, speedLimitsMode]);

  const filteredTorrents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let filtered = q ? torrents.filter((torrent) => torrent.name.toLowerCase().includes(q)) : [...torrents];
    if (filter.length > 0) {
      filtered = filtered.filter((t) => filter.some((f) => matchesTorrentFilter(t, f)));
    }
    filtered.sort((a, b) => {
      const cmp = compareTorrents(a, b, sortKey);
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return filtered;
  }, [search, torrents, filter, sortKey, sortDir]);

  const useVirtualization = !loading && filteredTorrents.length > 0;
  const rowHeight = isTableView ? TABLE_ROW_HEIGHT : TORRENT_ROW_HEIGHT;
  const virtualizer = useWindowVirtualizer({
    count: filteredTorrents.length,
    estimateSize: () => rowHeight,
    enabled: useVirtualization,
    overscan: 8,
    scrollMargin: listOffsetTop,
  });

  // The virtualizer caches row measurements; switching views changes the row
  // height, so drop the cache and re-measure with the new estimate. Layout
  // effect so the re-measure lands before paint (no stale-size flash); the
  // virtualizer instance is referentially stable across renders.
  useLayoutEffect(() => {
    virtualizer.measure();
  }, [rowHeight, virtualizer]);

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

  const activeFilterLabel = filter.length === 0
    ? 'All'
    : filter.length === 1
      ? filterOptions.find((o) => o.value === filter[0])?.label ?? filter[0]
      : `${filter.length} filters`;

  const selectAll = useCallback(() => {
    if (selectedTorrents.size === filteredTorrents.length) {
      setSelectedTorrents(new Set());
      return;
    }
    setSelectedTorrents(new Set(filteredTorrents.map((torrent) => torrent.hash)));
  }, [filteredTorrents, selectedTorrents.size]);

  // Shared by the table column headers and the sort dropdown: picking the
  // active key toggles direction; a new key gets its natural default.
  const handleHeaderSort = useCallback((key: SortKey) => {
    const { torrentsSortKey, torrentsSortDir } = useUIStore.getState();
    if (torrentsSortKey === key) {
      setSortDir(torrentsSortDir === 'asc' ? 'desc' : 'asc');
    } else {
      setSortKey(key);
      setSortDir(key === 'name' || key === 'category' || key === 'state' ? 'asc' : 'desc');
    }
  }, [setSortDir, setSortKey]);

  // Get detail torrent data from the list for session stats / magnet
  const detailTorrent = detailHash ? torrentByHash.get(detailHash) : null;

  return (
    <div className="space-y-3 animate-content-in">
      <PullToRefresh onRefresh={() => refetchSummary()} />
      <div className="page-toolbar page-toolbar-flush pb-2 app-chrome-bar bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80 space-y-2">
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
              <DropdownMenuCheckboxItem
                checked={filter.length === 0}
                onCheckedChange={() => setFilter([])}
                onSelect={(e) => e.preventDefault()}
              >
                All
              </DropdownMenuCheckboxItem>
              {filterOptions.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.value}
                  checked={filter.includes(opt.value)}
                  onCheckedChange={() => setFilter(
                    filter.includes(opt.value)
                      ? filter.filter((f) => f !== opt.value)
                      : [...filter, opt.value]
                  )}
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
                aria-label="Sort"
              >
                <ArrowUpDown className="h-5 w-5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-52 max-h-80 overflow-y-auto">
              <DropdownMenuLabel>Sort by</DropdownMenuLabel>
              <DropdownMenuSeparator />
              {SORT_OPTIONS.map((opt) => (
                <DropdownMenuCheckboxItem
                  key={opt.key}
                  checked={sortKey === opt.key}
                  onCheckedChange={() => handleHeaderSort(opt.key)}
                  onSelect={(e) => e.preventDefault()}
                >
                  {opt.label}
                  {sortKey === opt.key && (
                    <span className="ml-auto text-[10px] text-muted-foreground">{sortDir === 'asc' ? '↑' : '↓'}</span>
                  )}
                </DropdownMenuCheckboxItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>

          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors disabled:opacity-60 disabled:cursor-default"
                onClick={refresh}
                disabled={refreshing}
                aria-label="Refresh"
              >
                <RefreshCw className={`h-5 w-5 ${refreshing ? 'animate-spin' : ''}`} />
              </button>
            </TooltipTrigger>
            <TooltipContent>Refresh</TooltipContent>
          </Tooltip>

          {canBandwidthTorrents && (
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
          )}

          <div className="flex-1" />

          {canBandwidthTorrents && (
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
          )}

          {canAddTorrents && (
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
          )}
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
          <SearchInput
            placeholder="Search torrents..."
            value={search}
            onChange={setSearch}
            historyKey="torrents"
            className="pl-9"
          />
        </div>
      </div>

      {selectedTorrents.size > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/60 rounded-xl">
          <span className="text-xs text-muted-foreground mx-1 shrink-0">{selectedTorrents.size}</span>
          {canManageTorrents && (
            <button
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
              onClick={() => void bulkAction('start')}
              aria-label="Start"
            >
              <Play className="h-4 w-4" />
            </button>
          )}
          {canManageTorrents && (
            <button
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
              onClick={() => void bulkAction('stop')}
              aria-label="Stop"
            >
              <Pause className="h-4 w-4" />
            </button>
          )}
          {canManageTorrents && (
            <button
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
              onClick={() => void bulkAction('forceStart')}
              aria-label="Force Start"
            >
              <Zap className="h-4 w-4" />
            </button>
          )}
          {canBandwidthTorrents && (
            <button
              className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
              onClick={() => setBulkSpeedDrawer(true)}
              aria-label="Speed Limits"
            >
              <Gauge className="h-4 w-4" />
            </button>
          )}
          {canDeleteTorrents && (
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
          )}
          <div className="flex-1" />
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent text-xs text-muted-foreground"
            onClick={() => setSelectedTorrents(new Set())}
          >
            Clear
          </button>
        </div>
      )}

      {/* A failed background poll shouldn't blank a still-populated list; show a
          small inline banner instead and keep the last-good torrents rendered. */}
      {error && torrents.length > 0 && (
        <div className="mb-2 rounded-lg bg-destructive/10 px-3 py-2 text-center text-xs text-destructive">
          {error}
        </div>
      )}

      {loading && torrents.length === 0 ? (
        <ListSkeleton />
      ) : error && torrents.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          <p>{error}</p>
          <p className="text-sm mt-2">Make sure qBittorrent is configured in Settings.</p>
        </div>
      ) : filteredTorrents.length === 0 ? (
        <div className="rounded-xl bg-card p-8 text-center text-muted-foreground">
          {search ? 'No torrents match your search.' : 'No torrents found.'}
        </div>
      ) : (
        <div className="space-y-0">
          <div className="flex items-center gap-2 px-3 pb-2">
            {!isTableView && (
              <input
                type="checkbox"
                checked={selectedTorrents.size === filteredTorrents.length && filteredTorrents.length > 0}
                onChange={selectAll}
                className="rounded border-border"
              />
            )}
            <span className="text-xs text-muted-foreground">
              {filteredTorrents.length} torrent{filteredTorrents.length !== 1 ? 's' : ''}
            </span>
          </div>

          {/* listRef marks the virtualized list origin: its top must coincide
              with row 0's render position (scrollMargin is measured from it),
              so it wraps ONLY the spacers + rows — never the count bar or the
              table header. */}
          {isTableView ? (
            <div className="rounded-xl bg-card overflow-hidden">
              <TorrentTableHeader
                sortKey={sortKey}
                sortDir={sortDir}
                onSort={handleHeaderSort}
                allSelected={selectedTorrents.size === filteredTorrents.length && filteredTorrents.length > 0}
                onToggleAll={selectAll}
              />

              <div ref={listRef}>
                {topSpacerHeight > 0 && (
                  <div style={{ height: topSpacerHeight }} />
                )}

                <div className="divide-y divide-border/50">
                  {visibleTorrents.map((torrent) => (
                    <TorrentTableRow
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
            </div>
          ) : (
            <div ref={listRef}>
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
          <div className="px-4 pb-6 flex-1 min-h-0 overflow-y-auto space-y-4">
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
                {detailHash && canBandwidthTorrents && (
                  <div>
                    <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Speed Limits</h3>
                    <div className="rounded-lg border divide-y">
                      <SpeedLimitInput
                        label="Download Limit"
                        currentLimit={Number(detailData.properties.dl_limit) || 0}
                        onSave={async (limit) => {
                          const ok = await torrentAction(detailHash, 'setDownloadLimit', { limit });
                          // Refresh detail
                          if (ok) void fetchDetail(detailHash);
                          return ok;
                        }}
                      />
                      <SpeedLimitInput
                        label="Upload Limit"
                        currentLimit={Number(detailData.properties.up_limit) || 0}
                        onSave={async (limit) => {
                          const ok = await torrentAction(detailHash, 'setUploadLimit', { limit });
                          if (ok) void fetchDetail(detailHash);
                          return ok;
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
                {detailHash && detailTorrent && canManageTorrents && (
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
          <div className="px-4 pb-6 flex-1 min-h-0 overflow-y-auto space-y-4">
            <div>
              <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">View</h3>
              <div className="rounded-lg border divide-y">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-muted-foreground">Table View</span>
                  <Switch
                    checked={isTableView}
                    onCheckedChange={(checked) => setViewMode(checked ? 'table' : 'card')}
                  />
                </div>
              </div>
            </div>

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
                        const res = await fetch('/api/qbittorrent/transfer/limits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'setDownloadLimit', limit }),
                        });
                        if (!res.ok) throw new Error('Failed to set global download limit');
                        void fetchGlobalLimits();
                      }}
                    />
                    <SpeedLimitInput
                      label="Global Upload Limit"
                      currentLimit={globalLimits.uploadLimit}
                      onSave={async (limit) => {
                        const res = await fetch('/api/qbittorrent/transfer/limits', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ action: 'setUploadLimit', limit }),
                        });
                        if (!res.ok) throw new Error('Failed to set global upload limit');
                        void fetchGlobalLimits();
                      }}
                    />
                    <div className="flex items-center justify-between px-3 py-2">
                      <span className="text-xs text-muted-foreground">Alternative Speed Limits</span>
                      {/* Rendered from speedLimitsMode (not globalLimits) so the switch
                          gets the optimistic flip + pending-poll guard the toolbar
                          button already has — qBittorrent applies the toggle
                          asynchronously, so an immediate re-fetch reads the old mode. */}
                      <Switch
                        checked={speedLimitsMode === 1}
                        onCheckedChange={() => void toggleAltSpeedMode()}
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
          <div className="px-4 pb-6 flex-1 min-h-0 overflow-y-auto">
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
                  const ok = await bulkAction('setDownloadLimit', { limit });
                  if (ok) setBulkSpeedDrawer(false);
                  return ok;
                }}
              />
              <SpeedLimitInput
                label="Upload Limit"
                currentLimit={0}
                onSave={async (limit) => {
                  const ok = await bulkAction('setUploadLimit', { limit });
                  if (ok) setBulkSpeedDrawer(false);
                  return ok;
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
