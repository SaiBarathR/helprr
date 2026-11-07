'use client';

import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Loader2, Save, Search, ShieldCheck, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { formatBytes } from '@/lib/format';
import { jsonOk } from '@/lib/http';
import { formatDate } from '@/lib/date-format';
import type { LibraryCleanupSettings, LibraryMediaType, LibraryRule } from '@/lib/library-cleanup/config';
import {
  countdownLabel,
  fetchLeavingSoon,
  leavingSoonQueryKey,
  useKeepLeavingSoon,
} from '@/components/leaving-soon/leaving-soon-shelf';

interface Candidate {
  key: string;
  title: string;
  year: number | null;
  instanceLabel: string;
  sizeBytes: number;
  lastWatchedAt: string | null;
  requestedBy: string[];
  reasons: string[];
  leavingSoon: boolean;
}

interface PreviewResponse {
  scanned: number;
  candidates: Candidate[];
  totalBytes: number;
  excluded: Array<{ reason: string; count: number }>;
  warnings: string[];
}

interface DueItem {
  id: string;
  title: string;
  sizeBytes: number;
  status: 'ready' | 'protected' | 'gone';
  exclusions: string[];
}

interface DeletePreviewResponse {
  previewToken?: string;
  expiresAt?: string;
  items: DueItem[];
  readyCount: number;
  warnings: string[];
}

const CONFIG_KEY = ['cleanup', 'library', 'config'] as const;
// The most titles one mark request takes (MAX_MARK_ITEMS on the server).
const MAX_MARK = 500;
const PROTECTED = [
  'The keep tag in Sonarr/Radarr',
  'Anything on anyone’s watchlist',
  'An open request, or one made in the last N days (Seerr or Helprr)',
  'Anything still downloading',
  'Anything anyone watched in the last N days, on any Jellyfin account',
  'Titles Jellyfin doesn’t know, and titles with no files',
];

async function errorOf(res: Response, fallback: string): Promise<string> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  return body?.error ?? fallback;
}

function optionalNumber(raw: string): number | null {
  if (raw.trim() === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function RuleFields({ rule, onChange, label }: { rule: LibraryRule; onChange: (r: LibraryRule) => void; label: string }) {
  return (
    <section className="grouped-section">
      <div className="grouped-section-title">{label}</div>
      <div className="grouped-section-content">
        <div className="grouped-row">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${label}-unwatched`}>Not watched in</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Nobody on any Jellyfin account played it in this many days.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input id={`${label}-unwatched`} type="number" min={1} max={3650} className="w-20 sm:w-24" value={rule.unwatchedDays}
              onChange={(e) => onChange({ ...rule, unwatchedDays: Math.trunc(Number(e.target.value) || 0) })} />
            <span className="text-sm text-muted-foreground">days</span>
          </div>
        </div>
        <div className="grouped-row">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${label}-added`}>Added more than</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Days since it was added to Sonarr/Radarr.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input id={`${label}-added`} type="number" min={0} max={3650} className="w-20 sm:w-24" value={rule.addedDays}
              onChange={(e) => onChange({ ...rule, addedDays: Math.trunc(Number(e.target.value) || 0) })} />
            <span className="text-sm text-muted-foreground">days ago</span>
          </div>
        </div>
        <div className="grouped-row">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${label}-size`}>Minimum size</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Optional. Leave empty for any size.</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <Input id={`${label}-size`} type="number" min={0} step="any" className="w-20 sm:w-24" placeholder="Any" value={rule.minSizeGb ?? ''}
              onChange={(e) => onChange({ ...rule, minSizeGb: optionalNumber(e.target.value) })} />
            <span className="text-sm text-muted-foreground">GB</span>
          </div>
        </div>
        <div className="grouped-row">
          <div className="min-w-0 flex-1">
            <Label htmlFor={`${label}-rating`}>Rated below</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Optional, 0–10. Titles with no rating never match when this is set.</p>
          </div>
          <Input id={`${label}-rating`} type="number" min={0} max={10} step="0.1" className="w-20 sm:w-24 shrink-0" placeholder="Off" value={rule.maxRating ?? ''}
            onChange={(e) => onChange({ ...rule, maxRating: optionalNumber(e.target.value) })} />
        </div>
      </div>
    </section>
  );
}

export function LibraryCleanupTab({ onDirtyChange }: { onDirtyChange?: (dirty: boolean) => void }) {
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: CONFIG_KEY,
    queryFn: async () => jsonOk<LibraryCleanupSettings>(await fetch('/api/cleanup/library/config')),
  });
  const [draft, setDraft] = useState<LibraryCleanupSettings | null>(null);
  const [importExclusion, setImportExclusion] = useState(false);
  const [seededFrom, setSeededFrom] = useState<LibraryCleanupSettings | undefined>(undefined);
  // Re-seed the form whenever the saved settings change (first load, save, refresh).
  if (configQuery.data && configQuery.data !== seededFrom) {
    setSeededFrom(configQuery.data);
    setDraft(configQuery.data);
    setImportExclusion(configQuery.data.importListExclusion);
  }
  const [saving, setSaving] = useState(false);
  const dirty = Boolean(draft && configQuery.data && JSON.stringify(draft) !== JSON.stringify(configQuery.data));
  useEffect(() => { onDirtyChange?.(dirty); }, [dirty, onDirtyChange]);

  const [previewType, setPreviewType] = useState<LibraryMediaType>('movie');
  const [preview, setPreview] = useState<PreviewResponse | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [marking, setMarking] = useState(false);

  const leaving = useQuery({ queryKey: leavingSoonQueryKey(), queryFn: () => fetchLeavingSoon(), refetchInterval: 60_000 });
  const keep = useKeepLeavingSoon();
  // Countdowns and "Delete now" go by when the list was last read, so a title
  // that becomes due while the page is open shows up on the next read.
  const now = leaving.dataUpdatedAt;
  const dueCount = (leaving.data ?? []).filter((item) => Date.parse(item.deleteAfter) <= now).length;

  const [deletePreview, setDeletePreview] = useState<DeletePreviewResponse | null>(null);
  const [checkingDelete, setCheckingDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const selectable = useMemo(() => (preview?.candidates ?? []).filter((c) => !c.leavingSoon), [preview]);
  const selectedBytes = selectable.filter((c) => selected.has(c.key)).reduce((sum, c) => sum + c.sizeBytes, 0);

  if (configQuery.isError && !configQuery.data) {
    return (
      <div className="py-12 text-center text-sm text-muted-foreground">
        <p>Couldn’t load the library cleanup settings.</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => void configQuery.refetch()}>Retry</Button>
      </div>
    );
  }
  if (configQuery.isLoading || !draft) {
    return <div className="flex justify-center py-12"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  const save = async () => {
    setSaving(true);
    try {
      const res = await fetch('/api/cleanup/library/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(draft),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not save'));
      queryClient.setQueryData(CONFIG_KEY, await res.json());
      toast.success('Library cleanup saved');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not save');
    } finally {
      setSaving(false);
    }
  };

  const runPreview = async () => {
    setPreviewing(true);
    setSelected(new Set());
    try {
      const res = await fetch('/api/cleanup/library/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType: previewType }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Preview failed'));
      setPreview(await res.json() as PreviewResponse);
    } catch (error) {
      setPreview(null);
      toast.error(error instanceof Error ? error.message : 'Preview failed');
    } finally {
      setPreviewing(false);
    }
  };

  const mark = async () => {
    setMarking(true);
    try {
      const res = await fetch('/api/cleanup/library/leaving-soon', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mediaType: previewType, keys: [...selected] }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not mark titles'));
      const result = await res.json() as { marked: unknown[]; skipped: Array<{ title: string | null; reason: string }> };
      toast.success(`${result.marked.length} marked Leaving soon`, {
        description: result.skipped.length > 0
          ? `${result.skipped.length} skipped: ${result.skipped.slice(0, 3).map((s) => `${s.title ?? 'A title'} (${s.reason})`).join('; ')}`
          : undefined,
      });
      setSelected(new Set());
      void queryClient.invalidateQueries({ queryKey: ['leaving-soon'] });
      void runPreview();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not mark titles');
    } finally {
      setMarking(false);
    }
  };

  const checkDelete = async () => {
    setCheckingDelete(true);
    try {
      const res = await fetch('/api/cleanup/library/delete/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addImportListExclusion: importExclusion }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Could not check the titles'));
      setDeletePreview(await res.json() as DeletePreviewResponse);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not check the titles');
    } finally {
      setCheckingDelete(false);
    }
  };

  const runDelete = async () => {
    if (!deletePreview?.previewToken) return;
    setDeleting(true);
    try {
      const res = await fetch('/api/cleanup/library/delete/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ previewToken: deletePreview.previewToken }),
      });
      if (!res.ok) throw new Error(await errorOf(res, 'Nothing was deleted'));
      const result = await res.json() as { deleted: number; failed: number; skipped: number };
      const parts = [`${result.deleted} deleted`];
      if (result.failed) parts.push(`${result.failed} failed`);
      if (result.skipped) parts.push(`${result.skipped} skipped`);
      (result.failed ? toast.error : toast.success)(parts.join(', '), { description: 'Each title is in Cleanup History and the operation audit.' });
      setDeletePreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Nothing was deleted');
      setDeletePreview(null);
    } finally {
      setDeleting(false);
      void queryClient.invalidateQueries({ queryKey: ['leaving-soon'] });
      void queryClient.invalidateQueries({ queryKey: ['cleanup'] });
    }
  };

  return (
    <div className="space-y-6">
      <section className="grouped-section">
        <div className="grouped-section-title">How it works</div>
        <div className="grouped-section-content">
          <div className="grouped-row grouped-row-stacked gap-1.5">
            <p className="text-sm">Preview what a rule matches, mark titles Leaving soon, and delete them yourself once the countdown ends. Nothing is ever deleted automatically.</p>
            <p className="text-xs text-muted-foreground">Always protected, whatever the rule says:</p>
            <ul className="list-disc pl-5 text-xs text-muted-foreground space-y-0.5">
              {PROTECTED.map((line) => <li key={line}>{line}</li>)}
            </ul>
          </div>
        </div>
      </section>

      <RuleFields label="Movies" rule={draft.movieRule} onChange={(movieRule) => setDraft({ ...draft, movieRule })} />
      <RuleFields label="Series" rule={draft.seriesRule} onChange={(seriesRule) => setDraft({ ...draft, seriesRule })} />

      <section className="grouped-section">
        <div className="grouped-section-title">Options</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <div className="min-w-0 flex-1">
              <Label htmlFor="library-keep-tag">Keep tag</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Sonarr/Radarr tag that protects a title. Keep adds it. Changing it stops protecting titles kept with the old tag.</p>
            </div>
            <Input id="library-keep-tag" className="w-28 sm:w-36 shrink-0" value={draft.keepTag}
              onChange={(e) => setDraft({ ...draft, keepTag: e.target.value.toLowerCase() })} />
          </div>
          <div className="grouped-row">
            <div className="min-w-0 flex-1">
              <Label htmlFor="library-countdown">Countdown</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Days a title stays Leaving soon before it can be deleted.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <Input id="library-countdown" type="number" min={1} max={365} className="w-20 sm:w-24" value={draft.countdownDays}
                onChange={(e) => setDraft({ ...draft, countdownDays: Math.trunc(Number(e.target.value) || 0) })} />
              <span className="text-sm text-muted-foreground">days</span>
            </div>
          </div>
          <div className="grouped-row">
            <div className="min-w-0 flex-1">
              <Label>Tell requesters</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Push the people who requested a title when it is marked.</p>
            </div>
            <Switch aria-label="Tell requesters" checked={draft.notifyOnMark} onCheckedChange={(v) => setDraft({ ...draft, notifyOnMark: v })} />
          </div>
          <div className="grouped-row">
            <div className="min-w-0 flex-1">
              <Label>Import-list exclusion</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Default for Delete now: stop import lists adding the title back.</p>
            </div>
            <Switch aria-label="Import-list exclusion by default" checked={draft.importListExclusion} onCheckedChange={(v) => setDraft({ ...draft, importListExclusion: v })} />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={() => void save()} disabled={!dirty || saving}>
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          Save
        </Button>
      </div>

      <section className="grouped-section">
        <div className="grouped-section-title">Preview</div>
        <div className="grouped-section-content">
          <div className="grouped-row grouped-row-stack-mobile gap-2">
            <Tabs value={previewType} onValueChange={(v) => { if (previewing || marking) return; setPreviewType(v as LibraryMediaType); setPreview(null); setSelected(new Set()); }}>
              <TabsList variant="segmented">
                <TabsTrigger value="movie" disabled={previewing || marking}>Movies</TabsTrigger>
                <TabsTrigger value="series" disabled={previewing || marking}>Series</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button variant="secondary" onClick={() => void runPreview()} disabled={previewing || dirty}>
              {previewing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
              {dirty ? 'Save first' : 'Preview'}
            </Button>
          </div>
          {preview && (
            <>
              <div className="grouped-row grouped-row-stacked gap-1">
                <p className="text-sm">
                  <span className="tabular-nums">{preview.candidates.length}</span> of <span className="tabular-nums">{preview.scanned}</span> match ·{' '}
                  <span className="tabular-nums">{formatBytes(preview.totalBytes)}</span> reclaimable
                </p>
                {preview.excluded.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    Protected: {preview.excluded.map((e) => `${e.reason} (${e.count})`).join(' · ')}
                  </p>
                )}
                {preview.warnings.map((w) => (
                  <p key={w} className="flex items-center gap-1.5 text-xs text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>
                ))}
              </div>
              {selectable.length > 0 && (
                <div className="grouped-row">
                  <label className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={selected.size > 0 && selected.size === Math.min(selectable.length, MAX_MARK)}
                      onCheckedChange={(v) => setSelected(v ? new Set(selectable.slice(0, MAX_MARK).map((c) => c.key)) : new Set())}
                      aria-label="Select all"
                    />
                    {selectable.length > MAX_MARK ? `Select the largest ${MAX_MARK}` : 'Select all'}
                  </label>
                  <Button size="sm" onClick={() => void mark()} disabled={selected.size === 0 || marking}>
                    {marking && <Loader2 className="h-4 w-4 animate-spin" />}
                    Mark {selected.size || ''} Leaving soon{selected.size ? ` · ${formatBytes(selectedBytes)}` : ''}
                  </Button>
                </div>
              )}
              {preview.candidates.map((c) => (
                <label key={c.key} className="grouped-row items-start gap-3 cursor-pointer">
                  <Checkbox
                    className="mt-0.5"
                    disabled={c.leavingSoon}
                    checked={c.leavingSoon || selected.has(c.key)}
                    onCheckedChange={(v) => setSelected((prev) => {
                      const next = new Set(prev);
                      if (v && next.size < MAX_MARK) next.add(c.key); else if (!v) next.delete(c.key);
                      return next;
                    })}
                    aria-label={`Select ${c.title}`}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{c.title}{c.year ? ` (${c.year})` : ''}</p>
                    <p className="text-xs text-muted-foreground">
                      {c.reasons.join(' · ')}
                      {c.requestedBy.length > 0 && ` · Requested by ${c.requestedBy.join(', ')}`}
                      {` · ${c.instanceLabel}`}
                    </p>
                    {c.leavingSoon && <p className="text-xs text-amber-400">Already leaving soon</p>}
                  </div>
                  <span className="text-sm tabular-nums text-muted-foreground shrink-0">{formatBytes(c.sizeBytes)}</span>
                </label>
              ))}
              {preview.candidates.length === 0 && (
                <div className="grouped-row text-sm text-muted-foreground">Nothing matches this rule.</div>
              )}
            </>
          )}
        </div>
      </section>

      <section className="grouped-section">
        <div className="grouped-section-title">Leaving soon</div>
        <div className="grouped-section-content">
          {(leaving.data ?? []).length === 0 && (
            <div className="grouped-row text-sm text-muted-foreground">No titles are leaving soon.</div>
          )}
          {(leaving.data ?? []).map((item) => (
            <div key={item.id} className="grouped-row items-start gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium truncate">{item.title}{item.year ? ` (${item.year})` : ''}</p>
                <p className="text-xs text-amber-400">{countdownLabel(item.deleteAfter, now)} · {formatDate(item.deleteAfter)}</p>
                <p className="text-xs text-muted-foreground">
                  {[formatBytes(item.sizeBytes), ...(item.reasons ?? []),
                    item.requestedBy?.length ? `Requested by ${item.requestedBy.join(', ')}` : null,
                    item.markedByUsername ? `Marked by ${item.markedByUsername}` : null].filter(Boolean).join(' · ')}
                </p>
              </div>
              <Button size="sm" variant="secondary" className="h-9 shrink-0" disabled={keep.isPending && keep.variables?.id === item.id} onClick={() => keep.mutate(item)}>
                <ShieldCheck className="h-4 w-4" />
                Keep
              </Button>
            </div>
          ))}
          {dueCount > 0 && (
            <div className="grouped-row grouped-row-stack-mobile gap-2">
              <label className="flex items-center gap-2 text-sm">
                <Switch aria-label="Add import-list exclusion" checked={importExclusion} onCheckedChange={setImportExclusion} />
                Add import-list exclusion
              </label>
              <Button variant="destructive" onClick={() => void checkDelete()} disabled={checkingDelete}>
                {checkingDelete ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                Delete now…
              </Button>
            </div>
          )}
        </div>
      </section>

      <Dialog open={deletePreview !== null} onOpenChange={(open) => { if (!open && !deleting) setDeletePreview(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {deletePreview?.readyCount ?? 0} title{deletePreview?.readyCount === 1 ? '' : 's'} with their files?</DialogTitle>
            <DialogDescription>
              Every title was checked again just now. Protected ones are left alone. This preview expires in five minutes.
            </DialogDescription>
          </DialogHeader>
          <ul className="max-h-[50dvh] space-y-2 overflow-y-auto text-sm">
            {(deletePreview?.items ?? []).map((item) => (
              <li key={item.id} className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className={`truncate ${item.status === 'ready' ? '' : 'text-muted-foreground'}`}>{item.title}</p>
                  {item.status === 'protected' && <p className="text-xs text-muted-foreground">Kept: {item.exclusions.join(', ')}</p>}
                  {item.status === 'gone' && <p className="text-xs text-muted-foreground">Already removed from Sonarr/Radarr</p>}
                </div>
                <span className={`shrink-0 tabular-nums ${item.status === 'ready' ? 'text-destructive' : 'text-muted-foreground'}`}>
                  {item.status === 'ready' ? formatBytes(item.sizeBytes) : '—'}
                </span>
              </li>
            ))}
          </ul>
          {deletePreview?.warnings.map((w) => (
            <p key={w} className="flex items-center gap-1.5 text-xs text-amber-400"><AlertTriangle className="h-3.5 w-3.5 shrink-0" />{w}</p>
          ))}
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeletePreview(null)} disabled={deleting}>Cancel</Button>
            <Button variant="destructive" onClick={() => void runDelete()} disabled={deleting || !deletePreview?.previewToken}>
              {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              Delete now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
