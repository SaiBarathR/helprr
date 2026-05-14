'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Loader2, Trash2, Filter, X, ChevronLeft, ChevronRight, RotateCw } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import type { CleanupHistoryFiltersState } from '@/lib/store';

interface HistoryRow {
  id: string;
  cleaner: string;
  strikeType: string | null;
  ruleId: string | null;
  ruleName: string | null;
  hash: string;
  shortHash: string;
  torrentName: string;
  reason: string;
  action: string;
  filesDeleted: boolean;
  reSearched: boolean;
  linkedArrSource: string | null;
  linkedArrTitle: string | null;
  triggeredBy: string;
  createdAt: string;
}

const PAGE_SIZE = 30;

function buildSearchParams(f: CleanupHistoryFiltersState, page: number) {
  const sp = new URLSearchParams();
  sp.set('page', String(page));
  sp.set('pageSize', String(PAGE_SIZE));
  if (f.cleaner.length > 0) sp.set('cleaner', f.cleaner.join(','));
  if (f.strikeType.length > 0) sp.set('strikeType', f.strikeType.join(','));
  if (f.ruleId.length > 0) sp.set('ruleId', f.ruleId.join(','));
  if (f.dateFrom) sp.set('dateFrom', f.dateFrom);
  if (f.dateTo) sp.set('dateTo', f.dateTo);
  return sp;
}

export function CleanupHistoryTab() {
  const filters = useUIStore((s) => s.cleanupHistoryFilters);
  const setFilters = useUIStore((s) => s.setCleanupHistoryFilters);
  const resetFilters = useUIStore((s) => s.resetCleanupHistoryFilters);

  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<HistoryRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [deleteMode, setDeleteMode] = useState<null | 'all' | 'filtered'>(null);

  const fetchPage = useCallback(async () => {
    setLoading(true);
    try {
      const sp = buildSearchParams(filters, page);
      const r = await fetch(`/api/cleanup/history?${sp.toString()}`);
      const json = await r.json();
      setRows(json.records ?? []);
      setTotal(json.total ?? 0);
    } catch {
      toast.error('Failed to load history');
    } finally {
      setLoading(false);
    }
  }, [filters, page]);

  useEffect(() => { fetchPage(); }, [fetchPage]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const hasFilter = filters.cleaner.length + filters.strikeType.length + filters.ruleId.length > 0 || filters.dateFrom || filters.dateTo;

  const performDelete = async () => {
    if (!deleteMode) return;
    setDeleting(true);
    try {
      const sp = new URLSearchParams();
      if (deleteMode === 'all') sp.set('all', 'true');
      else {
        if (filters.cleaner.length > 0) sp.set('cleaner', filters.cleaner.join(','));
        if (filters.strikeType.length > 0) sp.set('strikeType', filters.strikeType.join(','));
        if (filters.ruleId.length > 0) sp.set('ruleId', filters.ruleId.join(','));
        if (filters.dateFrom) sp.set('dateFrom', filters.dateFrom);
        if (filters.dateTo) sp.set('dateTo', filters.dateTo);
      }
      const r = await fetch(`/api/cleanup/history?${sp.toString()}`, { method: 'DELETE' });
      const json = await r.json();
      toast.success(`Deleted ${json.deleted ?? 0} entries`);
      setDeleteMode(null);
      setPage(1);
      fetchPage();
    } catch {
      toast.error('Delete failed');
    } finally {
      setDeleting(false);
    }
  };

  const toggleArrayFilter = (key: 'cleaner' | 'strikeType', value: string) => {
    const cur = filters[key];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setFilters({ [key]: next } as Partial<CleanupHistoryFiltersState>);
  };

  return (
    <div className="space-y-4">
      <section className="grouped-section">
        <div className="grouped-section-title flex items-center justify-between">
          <span>Filters {hasFilter && <Badge variant="outline" className="ml-2">active</Badge>}</span>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="ghost" onClick={fetchPage} disabled={loading}>
              <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </Button>
            {hasFilter && (
              <Button size="sm" variant="ghost" onClick={() => { resetFilters(); setPage(1); }}>
                <X className="w-4 h-4 mr-1" /> Clear
              </Button>
            )}
          </div>
        </div>
        <div className="grouped-section-content p-3 space-y-3">
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">Cleaner:</span>
            {['queue', 'download'].map((c) => (
              <button key={c} type="button" onClick={() => toggleArrayFilter('cleaner', c)}
                className={`px-2 py-1 rounded-md text-xs border ${filters.cleaner.includes(c) ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <span className="text-xs text-muted-foreground">Type:</span>
            {['stall', 'slow', 'failedImport', 'downloadingMetadata'].map((c) => (
              <button key={c} type="button" onClick={() => toggleArrayFilter('strikeType', c)}
                className={`px-2 py-1 rounded-md text-xs border ${filters.strikeType.includes(c) ? 'bg-primary text-primary-foreground' : 'bg-background'}`}>
                {c}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-3 items-center text-xs text-muted-foreground">
            <Filter className="w-3.5 h-3.5" />
            <label className="flex items-center gap-1">
              From
              <input
                type="date"
                className="px-2 py-1 rounded-md border bg-background text-foreground"
                value={filters.dateFrom ?? ''}
                onChange={(e) => { setFilters({ dateFrom: e.target.value || null }); setPage(1); }}
              />
            </label>
            <label className="flex items-center gap-1">
              To
              <input
                type="date"
                className="px-2 py-1 rounded-md border bg-background text-foreground"
                value={filters.dateTo ?? ''}
                onChange={(e) => { setFilters({ dateTo: e.target.value || null }); setPage(1); }}
              />
            </label>
          </div>
          <div className="flex justify-end">
            <Button size="sm" variant="ghost" onClick={() => setDeleteMode(hasFilter ? 'filtered' : 'all')}>
              <Trash2 className="w-4 h-4 mr-1" /> Delete {hasFilter ? 'filtered' : 'all'}
            </Button>
          </div>
        </div>
      </section>

      <section className="grouped-section">
        <div className="grouped-section-title flex items-center justify-between">
          <span>Records ({total})</span>
          <span className="text-xs text-muted-foreground">page {page} / {totalPages}</span>
        </div>
        <div className="grouped-section-content">
          {loading ? (
            <div className="grouped-row text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="grouped-row text-sm text-muted-foreground">No history records.</div>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="grouped-row flex-col items-stretch gap-1">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge variant="outline" className="shrink-0 text-xs uppercase">{row.cleaner}</Badge>
                    {row.strikeType && <Badge variant="outline" className="shrink-0 text-xs">{row.strikeType}</Badge>}
                    <div className="font-medium truncate" title={row.torrentName}>{row.torrentName}</div>
                  </div>
                  <div className="text-xs text-muted-foreground shrink-0">{new Date(row.createdAt).toLocaleString()}</div>
                </div>
                <div className="text-xs text-muted-foreground flex flex-wrap gap-2 items-center">
                  <span className="font-mono">{row.shortHash}</span>
                  <span>•</span>
                  <span>{row.reason}</span>
                  {row.ruleName && (<><span>•</span><span>{row.ruleName}</span></>)}
                  {row.linkedArrTitle && (
                    <>
                      <span>•</span>
                      <span>{row.linkedArrSource}: {row.linkedArrTitle}</span>
                    </>
                  )}
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-3">
                  <span>{row.filesDeleted ? 'files deleted' : 'files kept'}</span>
                  {row.reSearched && <span>re-searched</span>}
                  <span>action: {row.action}</span>
                  <span>via: {row.triggeredBy}</span>
                </div>
              </div>
            ))
          )}
        </div>
      </section>

      <div className="flex items-center justify-between">
        <Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Prev
        </Button>
        <Button variant="ghost" size="sm" disabled={page >= totalPages} onClick={() => setPage(page + 1)}>
          Next <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      <Dialog open={!!deleteMode} onOpenChange={(o) => !o && setDeleteMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete history</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {deleteMode === 'all'
              ? `This will delete all ${total} history record${total === 1 ? '' : 's'}. This cannot be undone.`
              : `This will delete history records matching the current filters. This cannot be undone.`}
          </p>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDeleteMode(null)}>Cancel</Button>
            <Button variant="destructive" onClick={performDelete} disabled={deleting}>
              {deleting ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Trash2 className="w-4 h-4 mr-2" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
