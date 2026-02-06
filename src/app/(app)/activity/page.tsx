'use client';

import { useEffect, useState } from 'react';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Download, Check, X, ArrowUp, Trash2, Pause, Play, AlertTriangle,
  Upload, Loader2, RefreshCw, FileWarning,
} from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import type { QueueItem, HistoryItem, ManualImportItem } from '@/types';

function statusColor(status: string, tracked?: string) {
  if (tracked === 'warning' || status === 'warning') return 'bg-orange-500/10 text-orange-500';
  if (tracked === 'error' || status === 'failed') return 'bg-red-500/10 text-red-500';
  if (status === 'completed' || status === 'imported') return 'bg-green-500/10 text-green-500';
  if (status === 'downloading') return 'bg-blue-500/10 text-blue-500';
  return 'bg-muted text-muted-foreground';
}

function eventIcon(type: string) {
  switch (type) {
    case 'grabbed': return <Download className="h-3.5 w-3.5" />;
    case 'downloadFolderImported': case 'episodeFileImported': case 'movieFileImported': return <Check className="h-3.5 w-3.5" />;
    case 'downloadFailed': return <X className="h-3.5 w-3.5" />;
    case 'episodeFileDeleted': case 'movieFileDeleted': return <Trash2 className="h-3.5 w-3.5" />;
    case 'downloadIgnored': return <X className="h-3.5 w-3.5" />;
    default: return <ArrowUp className="h-3.5 w-3.5" />;
  }
}

export default function ActivityPage() {
  const [tab, setTab] = useState('queue');

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-bold">Activity</h1>
      <Tabs value={tab} onValueChange={setTab}>
        <TabsList>
          <TabsTrigger value="queue">Queue</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
          <TabsTrigger value="failed">Failed Imports</TabsTrigger>
        </TabsList>
        <TabsContent value="queue"><QueueTab /></TabsContent>
        <TabsContent value="history"><HistoryTab /></TabsContent>
        <TabsContent value="failed"><FailedImportsTab /></TabsContent>
      </Tabs>
    </div>
  );
}

function QueueTab() {
  const [queue, setQueue] = useState<(QueueItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);

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

  async function handleRemove(id: number, source: string) {
    try {
      await fetch(`/api/activity/queue/${id}?source=${source}&removeFromClient=true&blocklist=false`, { method: 'DELETE' });
      toast.success('Removed from queue');
      fetchQueue();
    } catch { toast.error('Failed to remove'); }
  }

  if (loading) return <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-16 rounded-lg" />)}</div>;
  if (queue.length === 0) return <div className="text-center py-12 text-muted-foreground">No items in queue</div>;

  return (
    <div className="space-y-2 mt-4">
      {queue.map((item) => {
        const progress = item.size > 0 ? ((item.size - item.sizeleft) / item.size) * 100 : 0;
        return (
          <Card key={`${item.source}-${item.id}`}>
            <CardContent className="p-3 space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{item.title}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <Badge variant="secondary" className={statusColor(item.status, item.trackedDownloadStatus)}>
                      {item.trackedDownloadState || item.status}
                    </Badge>
                    <Badge variant="outline" className="text-[10px]">{item.source}</Badge>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" className="h-7 w-7 p-0" onClick={() => handleRemove(item.id, item.source || 'sonarr')}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
              <Progress value={progress} className="h-1.5" />
              <div className="flex justify-between text-xs text-muted-foreground">
                <span>{progress.toFixed(0)}%</span>
                {item.timeleft && <span>{item.timeleft} remaining</span>}
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

function HistoryTab() {
  const [history, setHistory] = useState<(HistoryItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [eventFilter, setEventFilter] = useState('all');

  async function fetchHistory(p: number) {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: '20' });
      if (eventFilter !== 'all') params.set('eventType', eventFilter);
      const res = await fetch(`/api/activity/history?${params}`);
      if (res.ok) {
        const data = await res.json();
        if (p === 1) setHistory(data.records || []);
        else setHistory((prev) => [...prev, ...(data.records || [])]);
        setTotal(data.totalRecords || 0);
      }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { setPage(1); fetchHistory(1); }, [eventFilter]);

  return (
    <div className="space-y-3 mt-4">
      <Select value={eventFilter} onValueChange={setEventFilter}>
        <SelectTrigger className="w-[160px]"><SelectValue placeholder="Filter..." /></SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Events</SelectItem>
          <SelectItem value="grabbed">Grabbed</SelectItem>
          <SelectItem value="downloadFolderImported">Imported</SelectItem>
          <SelectItem value="downloadFailed">Failed</SelectItem>
          <SelectItem value="episodeFileDeleted">Deleted</SelectItem>
        </SelectContent>
      </Select>

      {loading && page === 1 ? (
        <div className="space-y-2">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-14 rounded-lg" />)}</div>
      ) : history.length === 0 ? (
        <div className="text-center py-12 text-muted-foreground">No history</div>
      ) : (
        <>
          <div className="space-y-1">
            {history.map((item, i) => (
              <div key={`${item.source}-${item.id}-${i}`} className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-muted/50">
                <div className={`p-1.5 rounded ${statusColor(item.eventType)}`}>{eventIcon(item.eventType)}</div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{item.sourceTitle}</p>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span>{item.quality?.quality?.name}</span>
                    <Badge variant="outline" className="text-[10px]">{item.source}</Badge>
                  </div>
                </div>
                <span className="text-xs text-muted-foreground shrink-0">
                  {formatDistanceToNow(new Date(item.date), { addSuffix: true })}
                </span>
              </div>
            ))}
          </div>
          {history.length < total && (
            <Button variant="ghost" className="w-full" onClick={() => { const next = page + 1; setPage(next); fetchHistory(next); }} disabled={loading}>
              {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Load more
            </Button>
          )}
        </>
      )}
    </div>
  );
}

function FailedImportsTab() {
  const [queue, setQueue] = useState<(QueueItem & { source?: string })[]>([]);
  const [loading, setLoading] = useState(true);
  const [importDialog, setImportDialog] = useState<{ item: QueueItem & { source?: string }; files: ManualImportItem[] } | null>(null);
  const [importLoading, setImportLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function fetchFailed() {
    try {
      const res = await fetch('/api/activity/queue');
      if (res.ok) {
        const data = await res.json();
        const failed = (data.records || []).filter(
          (r: QueueItem) => r.trackedDownloadState === 'importFailed' || r.trackedDownloadStatus === 'warning'
        );
        setQueue(failed);
      }
    } catch {} finally { setLoading(false); }
  }

  useEffect(() => { fetchFailed(); }, []);

  async function openManualImport(item: QueueItem & { source?: string }) {
    setImportLoading(true);
    setImportDialog({ item, files: [] });
    try {
      const params = new URLSearchParams({ downloadId: item.downloadId, source: item.source || 'sonarr' });
      if (item.seriesId) params.set('seriesId', String(item.seriesId));
      const res = await fetch(`/api/activity/manualimport?${params}`);
      if (res.ok) {
        const files = await res.json();
        setImportDialog({ item, files });
      }
    } catch { toast.error('Failed to scan files'); }
    finally { setImportLoading(false); }
  }

  async function submitImport() {
    if (!importDialog) return;
    setSubmitting(true);
    try {
      const res = await fetch('/api/activity/manualimport', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: importDialog.item.source, files: importDialog.files, name: 'ManualImport' }),
      });
      if (res.ok) {
        toast.success('Manual import submitted');
        setImportDialog(null);
        fetchFailed();
      } else { toast.error('Import failed'); }
    } catch { toast.error('Import failed'); }
    finally { setSubmitting(false); }
  }

  if (loading) return <div className="space-y-2">{[...Array(2)].map((_, i) => <Skeleton key={i} className="h-20 rounded-lg" />)}</div>;
  if (queue.length === 0) return <div className="text-center py-12 text-muted-foreground"><FileWarning className="h-8 w-8 mx-auto mb-2 opacity-50" /><p>No failed imports</p></div>;

  return (
    <div className="space-y-2 mt-4">
      {queue.map((item) => (
        <Card key={`${item.source}-${item.id}`}>
          <CardContent className="p-3 space-y-2">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}</p>
                <Badge variant="secondary" className="bg-red-500/10 text-red-500 mt-1">
                  <AlertTriangle className="h-3 w-3 mr-1" /> Import Failed
                </Badge>
                {item.statusMessages?.map((msg, i) => (
                  <p key={i} className="text-xs text-muted-foreground mt-1">{msg.title}: {msg.messages?.join(', ')}</p>
                ))}
              </div>
              <Button size="sm" onClick={() => openManualImport(item)}>
                <Upload className="mr-2 h-3.5 w-3.5" /> Manual Import
              </Button>
            </div>
          </CardContent>
        </Card>
      ))}

      <Dialog open={!!importDialog} onOpenChange={() => setImportDialog(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Manual Import</DialogTitle>
          </DialogHeader>
          {importLoading ? (
            <div className="space-y-2 py-4">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-12" />)}</div>
          ) : (
            <div className="max-h-80 overflow-y-auto space-y-2">
              {importDialog?.files.map((f, i) => (
                <div key={i} className="p-2 rounded-lg bg-muted/50 text-sm space-y-1">
                  <p className="font-medium truncate">{f.name || f.relativePath}</p>
                  <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
                    <span>{f.quality?.quality?.name}</span>
                    {f.series && <span>{f.series.title}</span>}
                    {f.movie && <span>{f.movie.title}</span>}
                    {f.episodes?.length ? <span>Ep {f.episodes.map(e => e.episodeNumber).join(', ')}</span> : null}
                  </div>
                  {f.rejections?.length > 0 && (
                    <div className="text-xs text-destructive">{f.rejections.map((r, ri) => <p key={ri}>{r.reason}</p>)}</div>
                  )}
                </div>
              ))}
              {importDialog?.files.length === 0 && <p className="text-center py-4 text-muted-foreground">No files detected</p>}
            </div>
          )}
          <DialogFooter>
            <Button variant="ghost" onClick={() => setImportDialog(null)}>Cancel</Button>
            <Button onClick={submitImport} disabled={submitting || !importDialog?.files.length}>
              {submitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Import
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
