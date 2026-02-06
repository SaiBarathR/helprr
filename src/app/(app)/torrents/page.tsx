'use client';

import { useEffect, useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogDescription,
} from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
  return <Badge variant={s.variant}>{s.label}</Badge>;
}

type FilterType = 'all' | 'downloading' | 'seeding' | 'completed' | 'paused' | 'active';

export default function TorrentsPage() {
  const [torrents, setTorrents] = useState<QBittorrentTorrent[]>([]);
  const [transferInfo, setTransferInfo] = useState<QBittorrentTransferInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<FilterType>('all');
  const [selectedTorrents, setSelectedTorrents] = useState<Set<string>>(new Set());

  // Add torrent dialog
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [addMode, setAddMode] = useState<'magnet' | 'file'>('magnet');
  const [magnetLink, setMagnetLink] = useState('');
  const [torrentFile, setTorrentFile] = useState<File | null>(null);
  const [adding, setAdding] = useState(false);

  // Delete dialog
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; hash: string; name: string; deleteFiles: boolean }>({
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
      setAddDialogOpen(false);
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
      await torrentAction(deleteDialog.hash, 'delete', { deleteFiles: deleteDialog.deleteFiles });
      setDeleteDialog({ open: false, hash: '', name: '', deleteFiles: false });
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

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <HardDrive className="h-6 w-6 text-green-500" />
          <h1 className="text-2xl font-bold">Torrents</h1>
        </div>
        <Button onClick={() => setAddDialogOpen(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Add Torrent
        </Button>
      </div>

      {/* Transfer Stats */}
      {transferInfo && (
        <div className="flex items-center gap-4 text-sm text-muted-foreground">
          <span className="flex items-center gap-1">
            <ArrowDown className="h-3.5 w-3.5 text-green-500" />
            {formatSpeed(transferInfo.dl_info_speed)}
          </span>
          <span className="flex items-center gap-1">
            <ArrowUp className="h-3.5 w-3.5 text-blue-500" />
            {formatSpeed(transferInfo.up_info_speed)}
          </span>
        </div>
      )}

      {/* Controls */}
      <div className="flex flex-col sm:flex-row gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search torrents..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={filter} onValueChange={(v) => setFilter(v as FilterType)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All</SelectItem>
            <SelectItem value="downloading">Downloading</SelectItem>
            <SelectItem value="seeding">Seeding</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="paused">Paused</SelectItem>
            <SelectItem value="active">Active</SelectItem>
          </SelectContent>
        </Select>
        <Button variant="outline" size="icon" onClick={() => { setLoading(true); fetchTorrents(); }}>
          <RefreshCw className="h-4 w-4" />
        </Button>
      </div>

      {/* Bulk Actions */}
      {selectedTorrents.size > 0 && (
        <div className="flex items-center gap-2 p-2 bg-muted rounded-md flex-wrap">
          <span className="text-sm text-muted-foreground mr-2">
            {selectedTorrents.size} selected
          </span>
          <Button variant="outline" size="sm" onClick={() => bulkAction('resume')}>
            <Play className="mr-1 h-3 w-3" /> Resume
          </Button>
          <Button variant="outline" size="sm" onClick={() => bulkAction('pause')}>
            <Pause className="mr-1 h-3 w-3" /> Pause
          </Button>
          <Button variant="outline" size="sm" onClick={() => bulkAction('forceStart')}>
            <Zap className="mr-1 h-3 w-3" /> Force Start
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => {
              const hashes = Array.from(selectedTorrents).join('|');
              setDeleteDialog({ open: true, hash: hashes, name: `${selectedTorrents.size} torrents`, deleteFiles: false });
            }}
          >
            <Trash2 className="mr-1 h-3 w-3" /> Delete
          </Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedTorrents(new Set())}>
            Clear
          </Button>
        </div>
      )}

      {/* Content */}
      {loading && torrents.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            <p>{error}</p>
            <p className="text-sm mt-2">Make sure qBittorrent is configured in Settings.</p>
          </CardContent>
        </Card>
      ) : filteredTorrents.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center text-muted-foreground">
            {search ? 'No torrents match your search.' : 'No torrents found.'}
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {/* Select All */}
          <div className="flex items-center gap-2 px-2">
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

          {filteredTorrents.map((torrent) => (
            <Card key={torrent.hash} className="overflow-hidden">
              <CardContent className="p-3 sm:p-4">
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
                          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0">
                            <MoreVertical className="h-4 w-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuItem onClick={() => torrentAction(torrent.hash, 'resume')}>
                            <Play className="mr-2 h-4 w-4" /> Resume
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => torrentAction(torrent.hash, 'pause')}>
                            <Pause className="mr-2 h-4 w-4" /> Pause
                          </DropdownMenuItem>
                          <DropdownMenuItem onClick={() => torrentAction(torrent.hash, 'forceStart')}>
                            <Zap className="mr-2 h-4 w-4" /> Force Start
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem
                            onClick={() => setDeleteDialog({ open: true, hash: torrent.hash, name: torrent.name, deleteFiles: false })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete (keep files)
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            className="text-destructive"
                            onClick={() => setDeleteDialog({ open: true, hash: torrent.hash, name: torrent.name, deleteFiles: true })}
                          >
                            <Trash2 className="mr-2 h-4 w-4" /> Delete with files
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      {getStateBadge(torrent.state)}
                      <span className="text-xs text-muted-foreground">
                        {formatBytes(torrent.size)}
                      </span>
                      {torrent.category && (
                        <Badge variant="outline" className="text-xs truncate max-w-[120px]">
                          {torrent.category}
                        </Badge>
                      )}
                    </div>

                    {/* Progress */}
                    <div className="mt-2">
                      <div className="flex justify-between text-xs text-muted-foreground mb-1 flex-wrap gap-x-2">
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
                      <Progress value={torrent.progress * 100} className="h-1.5" />
                    </div>

                    <div className="flex items-center gap-3 mt-1.5 text-xs text-muted-foreground">
                      <span>Seeds: {torrent.num_seeds}</span>
                      <span>Peers: {torrent.num_leechs}</span>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Add Torrent Dialog */}
      <Dialog open={addDialogOpen} onOpenChange={setAddDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Add Torrent</DialogTitle>
            <DialogDescription>Add a torrent via magnet link or .torrent file.</DialogDescription>
          </DialogHeader>

          <div className="flex gap-2 mb-4">
            <Button
              variant={addMode === 'magnet' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAddMode('magnet')}
            >
              <Link className="mr-2 h-4 w-4" />
              Magnet Link
            </Button>
            <Button
              variant={addMode === 'file' ? 'default' : 'outline'}
              size="sm"
              onClick={() => setAddMode('file')}
            >
              <FileUp className="mr-2 h-4 w-4" />
              Torrent File
            </Button>
          </div>

          {addMode === 'magnet' ? (
            <div className="space-y-2">
              <Input
                placeholder="magnet:?xt=urn:btih:..."
                value={magnetLink}
                onChange={(e) => setMagnetLink(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-2">
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
            </div>
          )}

          <DialogFooter>
            <Button variant="outline" onClick={() => setAddDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddTorrent} disabled={adding}>
              {adding ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Adding...
                </>
              ) : (
                'Add'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialog.open} onOpenChange={(open) => !open && setDeleteDialog({ ...deleteDialog, open: false })}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Torrent</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &ldquo;{deleteDialog.name}&rdquo;?
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteDialog.deleteFiles}
                onChange={(e) => setDeleteDialog({ ...deleteDialog, deleteFiles: e.target.checked })}
                className="rounded border-border"
              />
              <span className="text-sm">Also delete downloaded files</span>
            </label>
            {deleteDialog.deleteFiles && (
              <p className="text-xs text-destructive">
                Warning: This will permanently delete the downloaded files from disk.
              </p>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteDialog({ ...deleteDialog, open: false })}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDelete} disabled={deleting}>
              {deleting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
