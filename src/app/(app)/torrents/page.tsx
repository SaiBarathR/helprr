'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
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
import {
  HardDrive,
  Play,
  Pause,
  Zap,
  Trash2,
  Plus,
  Link,
  FileUp,
  MoreVertical,
  Loader2,
  ArrowDown,
  ArrowUp,
  RefreshCw,
  Search,
  Filter,
} from 'lucide-react';
import type { QBittorrentTorrent, QBittorrentTransferInfo } from '@/types';

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

type TorrentState =
  | 'downloading'
  | 'stalledDL'
  | 'uploading'
  | 'stalledUP'
  | 'pausedDL'
  | 'pausedUP'
  | 'queuedDL'
  | 'queuedUP'
  | 'checkingDL'
  | 'checkingUP'
  | 'forcedDL'
  | 'forcedUP'
  | 'missingFiles'
  | 'error'
  | 'moving'
  | 'unknown';

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

export default function TorrentsPage() {
  const [torrents, setTorrents] = useState<QBittorrentTorrent[]>([]);
  const [transferInfo, setTransferInfo] = useState<QBittorrentTransferInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());

  // Add torrent drawer
  const [addDrawerOpen, setAddDrawerOpen] = useState(false);
  const [addMode, setAddMode] = useState<'magnet' | 'file'>('magnet');
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);

  // Delete drawer
  const [deleteDrawer, setDeleteDrawer] = useState<{ open: boolean; hash: string; name: string; deleteFiles: boolean }>({
    open: false,
    hash: '',
    name: '',
    deleteFiles: false,
  });
  const [deleting, setDeleting] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchTorrents = useCallback(async () => {
    try {
      const qbtFilter = filter === 'all' ? undefined : filter;
      const url = qbtFilter ? `/api/qbittorrent?filter=${qbtFilter}` : '/api/qbittorrent';
      const res = await fetch(url);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      if (data.error) throw new Error(data.error);
      setTorrents(data);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch torrents');
    } finally {
      setLoading(false);
    }
  }, [filter]);

  const fetchTransferInfo = useCallback(async () => {
    try {
      const res = await fetch('/api/qbittorrent/transfer');
      if (res.ok) {
        const data = await res.json();
        setTransferInfo(data);
      }
    } catch {
      // Non-critical
    }
  }, []);

  useEffect(() => {
    fetchTorrents();
    fetchTransferInfo();
    const interval = setInterval(() => {
      fetchTorrents();
      fetchTransferInfo();
    }, 5000);
    return () => clearInterval(interval);
  }, [fetchTorrents, fetchTransferInfo]);

  async function torrentAction(hash: string, action: string, extra?: Record<string, unknown>) {
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
      toast.success(`${action} successful`);
      setTimeout(fetchTorrents, 500);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Action failed');
    }
  }

  async function bulkAction(action: string) {
    if (selectedTorrents.size === 0) return;
    const hashes = Array.from(selectedTorrents).join('|');
    await torrentAction(hashes, action);
    setSelectedTorrents(new Set());
  }

  async function handleAddTorrent() {
    setAdding(true);
    try {
      if (addMode === 'magnet') {
        if (!magnetLink.trim()) {
          toast.error('Please enter a magnet link');
          return;
        }
        const res = await fetch('/api/qbittorrent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ urls: magnetLink.trim() }),
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to add torrent');
        }
      } else {
        if (!torrentFile) {
          toast.error('Please select a .torrent file');
          return;
        }
        const formData = new FormData();
        formData.append('file', torrentFile);
        const res = await fetch('/api/qbittorrent', {
          method: 'POST',
          body: formData,
        });
        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || 'Failed to add torrent');
        }
      }
      toast.success('Torrent added');
      setAddDrawerOpen(false);
      setMagnetLink('');
      setTorrentFile(null);
      setTimeout(fetchTorrents, 1000);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add torrent');
    } finally {
      setAdding(false);
    }
  }

  async function handleDelete() {
    setDeleting(true);
    try {
      await torrentAction(deleteDrawer.hash, 'delete', { deleteFiles: deleteDrawer.deleteFiles });
      setDeleteDrawer({ open: false, hash: '', name: '', deleteFiles: false });
    } catch {
      // Error handled in torrentAction
    } finally {
      setDeleting(false);
    }
  }

  function toggleSelect(hash: string) {
    setSelectedTorrents((prev) => {
      const next = new Set(prev);
      if (next.has(hash)) {
        next.delete(hash);
      } else {
        next.add(hash);
      }
      return next;
    });
  }

  function selectAll() {
    if (selectedTorrents.size === filteredTorrents.length) {
      setSelectedTorrents(new Set());
    } else {
      setSelectedTorrents(new Set(filteredTorrents.map((t) => t.hash)));
    }
  }

  const filteredTorrents = torrents.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase())
  );

  const activeFilterLabel = filterOptions.find((o) => o.value === filter)?.label ?? 'All';

  return (
    <div className="space-y-3">
      {/* Top action bar */}
      <div className="flex items-center gap-2">
        {/* Filter dropdown */}
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

        {/* Refresh */}
        <button
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg hover:bg-accent active:bg-accent/80 transition-colors"
          onClick={() => { setLoading(true); fetchTorrents(); }}
          aria-label="Refresh"
        >
          <RefreshCw className="h-5 w-5" />
        </button>

        {/* Transfer stats (inline) */}
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

        {/* Add torrent button */}
        <button
          className="p-2 min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 transition-colors"
          onClick={() => setAddDrawerOpen(true)}
          aria-label="Add Torrent"
        >
          <Plus className="h-5 w-5" />
        </button>
      </div>

      {/* Search bar */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search torrents..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Bulk Actions */}
      {selectedTorrents.size > 0 && (
        <div className="flex items-center gap-1 px-2 py-1.5 bg-muted/60 rounded-xl">
          <span className="text-xs text-muted-foreground mx-1 shrink-0">
            {selectedTorrents.size}
          </span>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => bulkAction('resume')}
            aria-label="Resume"
          >
            <Play className="h-4 w-4" />
          </button>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => bulkAction('pause')}
            aria-label="Stop"
          >
            <Pause className="h-4 w-4" />
          </button>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent"
            onClick={() => bulkAction('forceStart')}
            aria-label="Force Start"
          >
            <Zap className="h-4 w-4" />
          </button>
          <button
            className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg hover:bg-accent text-destructive"
            onClick={() => {
              const hashes = Array.from(selectedTorrents).join('|');
              setDeleteDrawer({ open: true, hash: hashes, name: `${selectedTorrents.size} torrents`, deleteFiles: false });
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

      {/* Content */}
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
        <div className="space-y-0">
          {/* Select All */}
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

          <div className="rounded-xl bg-card overflow-hidden divide-y divide-border/50">
            {filteredTorrents.map((torrent) => (
              <div key={torrent.hash} className="px-3 py-3 sm:px-4">
                <div className="flex items-start gap-3">
                  <input
                    type="checkbox"
                    checked={selectedTorrents.has(torrent.hash)}
                    onChange={() => toggleSelect(torrent.hash)}
                    className="mt-1 rounded border-border"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="text-sm font-medium truncate">{torrent.name}</h3>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 -mt-0.5">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => torrentAction(torrent.hash, 'resume')}>
                            <Play className="mr-2 h-4 w-4" /> Resume
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => torrentAction(torrent.hash, 'pause')}>
                            <Pause className="mr-2 h-4 w-4" /> Stop
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => torrentAction(torrent.hash, 'forceStart')}>
                            <Zap className="mr-2 h-4 w-4" /> Force Start
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteDrawer({ open: true, hash: torrent.hash, name: torrent.name, deleteFiles: false })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete (keep files)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteDrawer({ open: true, hash: torrent.hash, name: torrent.name, deleteFiles: true })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete with files
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 mt-1">
                      {getStateBadge(torrent.state)}
                      <span className="text-[11px] text-muted-foreground">
                        {formatBytes(torrent.size)}
                      </span>
                      {torrent.category && (
                        <Badge variant="outline" className="text-[10px] px-1.5 py-0 truncate max-w-[120px]">
                          {torrent.category}
                        </Badge>
                      )}
                    </div>

                    {/* Progress */}
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
            ))}
          </div>
        </div>
      )}

      {/* Add Torrent Drawer */}
      <Drawer open={addDrawerOpen} onOpenChange={setAddDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Add Torrent</DrawerTitle>
            <DrawerDescription>Add a torrent via magnet link or .torrent file.</DrawerDescription>
          </DrawerHeader>

          <div className="px-4 space-y-4">
            <div className="flex gap-2">
              <Button
                variant={addMode === 'magnet' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAddMode('magnet')}
                className="flex-1"
              >
                <Link className="mr-2 h-4 w-4" />
                Magnet Link
              </Button>
              <Button
                variant={addMode === 'file' ? 'default' : 'outline'}
                size="sm"
                onClick={() => setAddMode('file')}
                className="flex-1"
              >
                <FileUp className="mr-2 h-4 w-4" />
                Torrent File
              </Button>
            </div>

            {addMode === 'magnet' ? (
              <Input
                placeholder="magnet:?xt=urn:btih:..."
                value={magnetLink}
                onChange={(e) => setMagnetLink(e.target.value)}
              />
            ) : (
              <>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".torrent"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) setTorrentFile(file);
                  }}
                />
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => fileInputRef.current?.click()}
                >
                  <FileUp className="mr-2 h-4 w-4" />
                  {torrentFile ? torrentFile.name : 'Choose .torrent file'}
                </Button>
              </>
            )}
          </div>

          <DrawerFooter>
            <Button onClick={handleAddTorrent} disabled={adding} className="w-full">
              {adding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add Torrent'
              )}
            </Button>
            <DrawerClose asChild>
              <Button variant="outline" className="w-full">Cancel</Button>
            </DrawerClose>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Delete Confirmation Drawer */}
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
