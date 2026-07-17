'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { format, subDays } from 'date-fns';
import type { DateRange } from 'react-day-picker';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import {
  Drawer,
  DrawerContent,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
  DrawerDescription,
} from '@/components/ui/drawer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import {
  Loader2,
  Trash2,
  X,
  ChevronLeft,
  ChevronRight,
  RotateCw,
  SlidersHorizontal,
  Calendar as CalendarIcon,
  Copy,
  Check,
  Eye,
} from 'lucide-react';
import { useUIStore } from '@/lib/store';
import type { CleanupHistoryFiltersState } from '@/lib/store';
import { jsonOk } from '@/lib/http';
import { resolveCleanupHistoryOutcomeStatus } from '@/lib/cleanup/history-status';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';

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
  errorMessage: string | null;
  previewId: string | null;
  outcomeStatus: string | null;
  outcomeDetails: {
    message?: string;
    targets?: Array<{
      target: string;
      instanceId?: string;
      queueItemId?: number;
      attempted: boolean;
      before: string;
      after: string;
      errorMessage?: string;
    }>;
  } | null;
}

const PAGE_SIZE = 30;

function toIsoDate(value: Date): string {
  return format(value, 'yyyy-MM-dd');
}
function parseIsoDate(value: string | null): Date | undefined {
  if (!value) return undefined;
  const d = new Date(`${value}T00:00:00`);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Convert YYYY-MM-DD picker values (local zone) to ISO timestamps with the
// browser's offset, so the server-side `dateFrom`/`dateTo` filter aligns
// with what the user sees.
function pickerDateToIsoStart(local: string | null): string | null {
  if (!local) return null;
  const d = new Date(`${local}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}
function pickerDateToIsoEndExclusive(local: string | null): string | null {
  if (!local) return null;
  const d = new Date(`${local}T00:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  d.setDate(d.getDate() + 1);
  return d.toISOString();
}

const QUICK_RANGES: { label: string; days: number }[] = [
  { label: '24h', days: 1 },
  { label: '7d', days: 7 },
  { label: '30d', days: 30 },
  { label: '3m', days: 90 },
];

const CLEANER_OPTIONS = [
  { value: 'queue', label: 'Queue' },
  { value: 'download', label: 'Download' },
];

const STRIKE_TYPE_OPTIONS = [
  { value: 'stall', label: 'Stall' },
  { value: 'slow', label: 'Slow' },
  { value: 'failedImport', label: 'Failed import' },
  { value: 'downloadingMetadata', label: 'Metadata stuck' },
];

const ACTION_OPTIONS = [
  { value: 'strikeAdded', label: 'Strike added' },
  { value: 'removedFromClient', label: 'Removed' },
  { value: 'removedFromQueue', label: 'Queue-only' },
  { value: 'categoryChanged', label: 'Category changed' },
  { value: 'skipped', label: 'Skipped' },
  { value: 'dryRunPreview', label: 'Dry-run preview' },
  { value: 'failed', label: 'Failed', destructive: true },
];

function buildSearchParams(f: CleanupHistoryFiltersState, page: number) {
  const sp = new URLSearchParams();
  sp.set('page', String(page));
  sp.set('pageSize', String(PAGE_SIZE));
  if (f.cleaner.length > 0) sp.set('cleaner', f.cleaner.join(','));
  if (f.strikeType.length > 0) sp.set('strikeType', f.strikeType.join(','));
  if (f.ruleId.length > 0) sp.set('ruleId', f.ruleId.join(','));
  const actions = f.action ?? [];
  if (actions.length > 0) sp.set('action', actions.join(','));
  if (f.reSearched === 'yes') sp.set('reSearched', 'true');
  else if (f.reSearched === 'no') sp.set('reSearched', 'false');
  const dateFromIso = pickerDateToIsoStart(f.dateFrom);
  if (dateFromIso) sp.set('dateFrom', dateFromIso);
  const dateToIso = pickerDateToIsoEndExclusive(f.dateTo);
  if (dateToIso) sp.set('dateTo', dateToIso);
  return sp;
}

export function CleanupHistoryTab() {
  const filtersRaw = useUIStore((s) => s.cleanupHistoryFilters);
  const setFilters = useUIStore((s) => s.setCleanupHistoryFilters);
  const resetFilters = useUIStore((s) => s.resetCleanupHistoryFilters);

  // Coalesce against legacy persisted state that may lack the new `action` /
  // `reSearched` fields.
  const filters: CleanupHistoryFiltersState = useMemo(() => ({
    ...filtersRaw,
    action: filtersRaw.action ?? [],
    reSearched: filtersRaw.reSearched ?? null,
  }), [filtersRaw]);

  const [page, setPage] = useState(1);
  const queryClient = useQueryClient();
  const [deleteMode, setDeleteMode] = useState<null | 'all' | 'filtered'>(null);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [detailRow, setDetailRow] = useState<HistoryRow | null>(null);

  const filterKey = useMemo(() => JSON.stringify(filters), [filters]);

  const historyQuery = useQuery({
    queryKey: ['cleanup', 'history', filterKey, page],
    queryFn: async ({ signal }) => {
      const sp = buildSearchParams(filters, page);
      const r = await fetch(`/api/cleanup/history?${sp.toString()}`, { signal });
      return jsonOk<{ records?: HistoryRow[]; total?: number }>(r);
    },
  });
  const rows = historyQuery.data?.records ?? [];
  const total = historyQuery.data?.total ?? 0;
  const loading = historyQuery.isLoading;

  // Preserve the old "Failed to load history" toast on fetch failure.
  useEffect(() => {
    if (historyQuery.isError) toast.error('Failed to load history');
  }, [historyQuery.isError]);

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const activeFilterCount =
    filters.cleaner.length
    + filters.strikeType.length
    + filters.ruleId.length
    + (filters.action ?? []).length
    + (filters.reSearched ? 1 : 0)
    + (filters.dateFrom ? 1 : 0)
    + (filters.dateTo ? 1 : 0);
  const hasFilter = activeFilterCount > 0;

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const sp = new URLSearchParams();
      if (deleteMode === 'all') {
        sp.set('all', 'true');
      } else {
        const filterSp = buildSearchParams(filters, 1);
        filterSp.delete('page');
        filterSp.delete('pageSize');
        for (const [k, v] of filterSp.entries()) sp.set(k, v);
      }
      const r = await fetch(`/api/cleanup/history?${sp.toString()}`, { method: 'DELETE' });
      return jsonOk<{ deleted?: number }>(r);
    },
    onSuccess: (json) => {
      toast.success(`Deleted ${json.deleted ?? 0} entries`);
      setDeleteMode(null);
      setPage(1);
      void queryClient.invalidateQueries({ queryKey: ['cleanup', 'history'] });
    },
    onError: () => toast.error('Delete failed'),
  });
  const deleting = deleteMutation.isPending;
  const performDelete = () => {
    if (deleteMode) deleteMutation.mutate();
  };

  const toggleArrayFilter = (key: 'cleaner' | 'strikeType' | 'action', value: string) => {
    const cur = (filters[key] ?? []) as string[];
    const next = cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value];
    setFilters({ [key]: next } as Partial<CleanupHistoryFiltersState>);
    setPage(1);
  };

  const setDateRange = (from: string | null, to: string | null) => {
    setFilters({ dateFrom: from, dateTo: to });
    setPage(1);
  };

  const applyQuickRange = (days: number) => {
    const to = new Date();
    const from = subDays(to, days - 1);
    setDateRange(toIsoDate(from), toIsoDate(to));
  };

  const dateRangeForCalendar: DateRange | undefined = useMemo(() => {
    const from = parseIsoDate(filters.dateFrom);
    const to = parseIsoDate(filters.dateTo);
    if (!from && !to) return undefined;
    return { from, to };
  }, [filters.dateFrom, filters.dateTo]);

  const dateRangeLabel = useMemo(() => {
    if (!filters.dateFrom && !filters.dateTo) return 'Any time';
    const parsedFrom = filters.dateFrom ? parseIsoDate(filters.dateFrom) : undefined;
    const parsedTo = filters.dateTo ? parseIsoDate(filters.dateTo) : undefined;
    const fromStr = parsedFrom ? format(parsedFrom, 'MMM d, yyyy') : '…';
    const toStr = parsedTo ? format(parsedTo, 'MMM d, yyyy') : 'now';
    return fromStr === toStr ? fromStr : `${fromStr} → ${toStr}`;
  }, [filters.dateFrom, filters.dateTo]);

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-2 flex-wrap">
        <Button
          variant={hasFilter ? 'default' : 'outline'}
          size="sm"
          onClick={() => setDrawerOpen(true)}
          className="relative"
        >
          <SlidersHorizontal className="w-4 h-4 mr-2" />
          Filters
          {hasFilter && (
            <Badge variant="secondary" className="ml-2 h-5 px-1.5 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
        {hasFilter && (
          <Button variant="ghost" size="sm" onClick={() => { resetFilters(); setPage(1); }}>
            <X className="w-4 h-4 mr-1" /> Clear
          </Button>
        )}
        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" variant="ghost" onClick={() => historyQuery.refetch()} disabled={loading} aria-label="Refresh">
            <RotateCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setDeleteMode(hasFilter ? 'filtered' : 'all')}
            disabled={total === 0}
          >
            <Trash2 className="w-4 h-4 mr-1" />
            <span className="hidden sm:inline">Delete {hasFilter ? 'filtered' : 'all'}</span>
            <span className="sm:hidden">Delete</span>
          </Button>
        </div>
      </div>

      {/* Records */}
      <section className="grouped-section">
        <div className="grouped-section-title flex items-center justify-between">
          <span>Records ({total})</span>
          <span className="text-xs text-muted-foreground">page {page} / {totalPages}</span>
        </div>
        <div className="grouped-section-content">
          {loading ? (
            <div className="grouped-row text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : rows.length === 0 ? (
            <div className="grouped-row text-sm text-muted-foreground">
              {hasFilter ? 'No records match the current filters.' : 'No history records yet. Once cleaners run, removals and previews will show up here.'}
            </div>
          ) : (
            rows.map((row) => (
              <HistoryRowCard key={row.id} row={row} onSelect={setDetailRow} />
            ))
          )}
        </div>
      </section>

      {/* Pagination */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <Button variant="outline" size="sm" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)}>
          <ChevronLeft className="w-4 h-4 mr-1" /> Prev
        </Button>
        <div className="flex items-center gap-2">
          <Label className="text-xs text-muted-foreground">Page</Label>
          <Input
            type="number"
            min={1}
            max={totalPages}
            value={page}
            onChange={(e) => {
              const next = Math.max(1, Math.min(totalPages, Number(e.target.value) || 1));
              setPage(next);
            }}
            className="w-16 h-8"
          />
          <span className="text-xs text-muted-foreground">/ {totalPages}</span>
        </div>
        <Button variant="outline" size="sm" disabled={page >= totalPages || loading} onClick={() => setPage(page + 1)}>
          Next <ChevronRight className="w-4 h-4 ml-1" />
        </Button>
      </div>

      {/* Filter drawer */}
      <Drawer open={drawerOpen} onOpenChange={setDrawerOpen}>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>Filter history</DrawerTitle>
          </DrawerHeader>
          <div className="px-4 pb-2 space-y-5 overflow-y-auto flex-1 min-h-0">
            <FilterChipGroup
              label="Cleaner"
              options={CLEANER_OPTIONS}
              value={filters.cleaner}
              onToggle={(v) => toggleArrayFilter('cleaner', v)}
            />

            <Separator />

            <FilterChipGroup
              label="Strike type"
              options={STRIKE_TYPE_OPTIONS}
              value={filters.strikeType}
              onToggle={(v) => toggleArrayFilter('strikeType', v)}
            />

            <Separator />

            <FilterChipGroup
              label="Action"
              options={ACTION_OPTIONS}
              value={filters.action ?? []}
              onToggle={(v) => toggleArrayFilter('action', v)}
            />

            <Separator />

            <ReSearchedFilter
              value={filters.reSearched ?? null}
              onChange={(v) => { setFilters({ reSearched: v }); setPage(1); }}
            />

            <Separator />

            <div className="space-y-2">
              <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Date range</p>
              <div className="flex flex-wrap gap-1.5">
                {QUICK_RANGES.map((r) => (
                  <button
                    key={r.label}
                    type="button"
                    onClick={() => applyQuickRange(r.days)}
                    className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                  >
                    {r.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setDateRange(null, null)}
                  className="px-2.5 py-1 rounded-md text-xs font-medium bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
                >
                  All time
                </button>
              </div>
              <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
                <PopoverTrigger asChild>
                  <Button variant="outline" className="w-full justify-start text-left text-xs h-9 font-normal">
                    <CalendarIcon className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                    {dateRangeLabel}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <Calendar
                    mode="range"
                    selected={dateRangeForCalendar}
                    onSelect={(range) => {
                      setDateRange(
                        range?.from ? toIsoDate(range.from) : null,
                        range?.to ? toIsoDate(range.to) : null,
                      );
                      if (range?.to) setCalendarOpen(false);
                    }}
                    disabled={{ after: new Date() }}
                    numberOfMonths={1}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
          <DrawerFooter className="flex-row gap-2">
            <Button
              variant="outline"
              className="h-11"
              onClick={() => {
                setDrawerOpen(false);
                setDeleteMode(hasFilter ? 'filtered' : 'all');
              }}
              disabled={total === 0}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Delete…
            </Button>
            <div className="flex-1" />
            <Button
              variant="ghost"
              className="h-11"
              onClick={() => { resetFilters(); setPage(1); }}
            >
              Reset
            </Button>
            <Button className="h-11" onClick={() => setDrawerOpen(false)}>
              Done
            </Button>
          </DrawerFooter>
        </DrawerContent>
      </Drawer>

      {/* Detail drawer */}
      <HistoryDetailDrawer row={detailRow} onClose={() => setDetailRow(null)} />

      {/* Bulk delete confirmation */}
      <Dialog open={!!deleteMode} onOpenChange={(o) => !o && setDeleteMode(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete history</DialogTitle>
          </DialogHeader>
          <p className="text-sm">
            {deleteMode === 'all'
              ? `This will delete all ${total} history record${total === 1 ? '' : 's'}. This cannot be undone.`
              : 'This will delete history records matching the current filters. This cannot be undone.'}
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

function ReSearchedFilter({
  value,
  onChange,
}: {
  value: 'yes' | 'no' | null;
  onChange: (v: 'yes' | 'no' | null) => void;
}) {
  const options: { value: 'yes' | 'no' | null; label: string }[] = [
    { value: null, label: 'Any' },
    { value: 'yes', label: 'Yes' },
    { value: 'no', label: 'No' },
  ];
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Re-searched</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = value === o.value;
          return (
            <button
              key={String(o.value)}
              type="button"
              onClick={() => onChange(o.value)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors min-h-[32px] ${selected
                ? 'bg-primary text-primary-foreground border-primary'
                : 'bg-muted/40 text-foreground border-transparent hover:bg-muted'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function FilterChipGroup({
  label,
  options,
  value,
  onToggle,
}: {
  label: string;
  options: { value: string; label: string; destructive?: boolean }[];
  value: string[];
  onToggle: (v: string) => void;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">{label}</p>
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => {
          const selected = value.includes(o.value);
          const selectedClass = o.destructive
            ? 'bg-destructive text-destructive-foreground border-destructive'
            : 'bg-primary text-primary-foreground border-primary';
          return (
            <button
              key={o.value}
              type="button"
              onClick={() => onToggle(o.value)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-medium border transition-colors min-h-[32px] ${selected
                ? selectedClass
                : 'bg-muted/40 text-foreground border-transparent hover:bg-muted'
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function HistoryRowCard({
  row,
  onSelect,
}: {
  row: HistoryRow;
  onSelect: (row: HistoryRow) => void;
}) {
  const displayedOutcomeStatus = resolveCleanupHistoryOutcomeStatus(row.outcomeStatus, row.action);
  const isFailed = displayedOutcomeStatus === 'failed';
  const isPartial = displayedOutcomeStatus === 'partial';
  const isStale = displayedOutcomeStatus === 'stale';
  const isDryRun = row.action === 'dryRunPreview';
  const isStrikeAdded = row.action === 'strikeAdded';
  const isSkipped = row.action === 'skipped';
  return (
    <QuickContextMenu
      label={`${row.torrentName} cleanup history actions`}
      actions={[
        {
          id: 'details',
          label: 'View details',
          icon: <Eye />,
          onSelect: () => onSelect(row),
        },
        {
          id: 'copy-hash',
          label: 'Copy torrent hash',
          icon: <Copy />,
          onSelect: () => {
            void navigator.clipboard.writeText(row.hash)
              .then(() => toast.success('Torrent hash copied'))
              .catch(() => toast.error('Could not copy torrent hash'));
          },
        },
      ]}
    >
    <button
      type="button"
      onClick={() => onSelect(row)}
      className={`grouped-row w-full text-left flex-col items-stretch gap-1.5 cursor-pointer transition-colors hover:bg-muted/30 active:bg-muted/40 ${isFailed ? 'bg-destructive/5' : ''}`}
    >
      <div className="flex items-start gap-2 min-w-0 w-full">
        <div className="flex-1 min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="outline" className="uppercase tracking-wide">{row.cleaner}</Badge>
            {row.strikeType && <Badge variant="outline">{row.strikeType}</Badge>}
            {isFailed && <Badge variant="destructive">failed</Badge>}
            {isPartial && <Badge variant="secondary">partial</Badge>}
            {isStale && <Badge variant="secondary">stale</Badge>}
            {displayedOutcomeStatus === 'succeeded' && <Badge variant="default">succeeded</Badge>}
            {isDryRun && <Badge variant="secondary">dry-run</Badge>}
            {isStrikeAdded && <Badge variant="secondary">strike</Badge>}
            {isSkipped && <Badge variant="secondary">skipped</Badge>}
          </div>
          <div className="font-medium text-sm break-words min-w-0">
            {row.torrentName}
          </div>
        </div>
        <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0 mt-1" />
      </div>
      <div className="text-xs text-muted-foreground flex flex-wrap gap-x-3 gap-y-0.5 min-w-0">
        <span className="font-mono">{row.shortHash}</span>
        <span className="break-words min-w-0">{row.reason}</span>
        {row.ruleName && <span className="break-words min-w-0">rule: {row.ruleName}</span>}
        {row.linkedArrTitle && (
          <span className="break-words min-w-0">{row.linkedArrSource}: {row.linkedArrTitle}</span>
        )}
      </div>
      <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5">
        <span>action: {row.action}</span>
        <span>{row.filesDeleted ? 'files deleted' : 'files kept'}</span>
        {row.reSearched && <span>re-searched</span>}
        <span>via: {row.triggeredBy}</span>
        {row.previewId && <span>preview: {row.previewId.slice(0, 8)}</span>}
        <span className="ml-auto whitespace-nowrap">{new Date(row.createdAt).toLocaleString()}</span>
      </div>
      {row.errorMessage && (
        <div className="text-xs text-destructive break-words">
          Error: {row.errorMessage}
        </div>
      )}
    </button>
    </QuickContextMenu>
  );
}

function HistoryDetailDrawer({
  row,
  onClose,
}: {
  row: HistoryRow | null;
  onClose: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const open = row !== null;
  const displayedOutcomeStatus = row
    ? resolveCleanupHistoryOutcomeStatus(row.outcomeStatus, row.action)
    : null;

  const copyHash = async () => {
    if (!row) return;
    try {
      await navigator.clipboard.writeText(row.hash);
      setCopied(true);
      toast.success('Hash copied');
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      toast.error('Copy failed');
    }
  };

  return (
    <Drawer open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>History detail</DrawerTitle>
          {row && (
            <DrawerDescription>
              {new Date(row.createdAt).toLocaleString()}
            </DrawerDescription>
          )}
        </DrawerHeader>
        <div className="px-4 pb-2 space-y-4 overflow-y-auto flex-1 min-h-0">
          {row && (
            <>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="outline" className="uppercase tracking-wide">{row.cleaner}</Badge>
                {row.strikeType && <Badge variant="outline">{row.strikeType}</Badge>}
                {displayedOutcomeStatus === 'failed' && <Badge variant="destructive">failed</Badge>}
                {displayedOutcomeStatus === 'partial' && <Badge variant="secondary">partial</Badge>}
                {displayedOutcomeStatus === 'stale' && <Badge variant="secondary">stale</Badge>}
                {displayedOutcomeStatus === 'succeeded' && <Badge variant="default">succeeded</Badge>}
                {row.action === 'dryRunPreview' && <Badge variant="secondary">dry-run</Badge>}
                {row.action === 'strikeAdded' && <Badge variant="secondary">strike</Badge>}
                {row.action === 'skipped' && <Badge variant="secondary">skipped</Badge>}
              </div>

              <DetailField label="Torrent">
                <div className="text-sm font-medium break-words">{row.torrentName}</div>
              </DetailField>

              <DetailField label="Hash">
                <button
                  type="button"
                  onClick={copyHash}
                  className="flex items-start gap-2 text-left w-full group"
                  title="Tap to copy"
                >
                  <span className="font-mono text-xs break-all flex-1 min-w-0 text-foreground group-hover:text-primary transition-colors">
                    {row.hash}
                  </span>
                  {copied ? (
                    <Check className="w-3.5 h-3.5 shrink-0 mt-0.5 text-primary" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 shrink-0 mt-0.5 text-muted-foreground group-hover:text-primary transition-colors" />
                  )}
                </button>
              </DetailField>

              <DetailField label="Reason">
                <div className="text-sm break-words">{row.reason}</div>
              </DetailField>

              <div className="grid grid-cols-2 gap-3">
                <DetailField label="Action">
                  <div className="text-sm break-words">{row.action}</div>
                </DetailField>
                <DetailField label="Files">
                  <div className="text-sm">{row.filesDeleted ? 'Deleted' : 'Kept'}</div>
                </DetailField>
                <DetailField label="Re-searched">
                  <div className="text-sm">{row.reSearched ? 'Yes' : 'No'}</div>
                </DetailField>
                <DetailField label="Triggered by">
                  <div className="text-sm break-words">{row.triggeredBy}</div>
                </DetailField>
                {row.outcomeStatus && (
                  <DetailField label="Outcome">
                    <div className="text-sm break-words">{row.outcomeStatus}</div>
                  </DetailField>
                )}
                {row.ruleName && (
                  <DetailField label="Rule">
                    <div className="text-sm break-words">{row.ruleName}</div>
                  </DetailField>
                )}
                {row.linkedArrTitle && (
                  <DetailField label={row.linkedArrSource ?? 'Linked'}>
                    <div className="text-sm break-words">{row.linkedArrTitle}</div>
                  </DetailField>
                )}
              </div>

              {row.errorMessage && (
                <DetailField label="Error">
                  <div className="text-sm text-destructive break-words">
                    {row.errorMessage}
                  </div>
                </DetailField>
              )}

              {row.outcomeDetails?.message && (
                <DetailField label="Reconciliation">
                  <div className="text-sm break-words">{row.outcomeDetails.message}</div>
                </DetailField>
              )}

              {row.outcomeDetails?.targets && row.outcomeDetails.targets.length > 0 && (
                <DetailField label="Upstream targets">
                  <div className="space-y-2">
                    {row.outcomeDetails.targets.map((target, index) => (
                      <div key={`${target.target}:${target.instanceId ?? ''}:${target.queueItemId ?? index}`} className="rounded-md border px-3 py-2 text-xs">
                        <div className="font-medium">
                          {target.target}{target.instanceId ? ` · ${target.instanceId}` : ''}{target.queueItemId != null ? ` · queue ${target.queueItemId}` : ''}
                        </div>
                        <div className="text-muted-foreground mt-0.5">
                          {target.attempted ? 'attempted' : 'not attempted'} · {target.before} → {target.after}
                        </div>
                        {target.errorMessage && <div className="text-destructive mt-1 break-words">{target.errorMessage}</div>}
                      </div>
                    ))}
                  </div>
                </DetailField>
              )}
            </>
          )}
        </div>
        <DrawerFooter>
          <Button onClick={onClose} className="h-11">Close</Button>
        </DrawerFooter>
      </DrawerContent>
    </Drawer>
  );
}

function DetailField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1 min-w-0">
      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
        {label}
      </p>
      {children}
    </div>
  );
}
