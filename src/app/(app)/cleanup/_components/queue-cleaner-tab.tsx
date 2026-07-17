'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { TokenInput, type TokenSuggestionGroup } from '@/components/ui/token-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loader2, Plus, Save, Trash2, AlertTriangle, Info, Pencil, ChevronUp, Power } from 'lucide-react';
import { QuickContextMenu } from '@/components/ui/quick-context-menu';
import type {
  AutoRunMode,
  FailedImportConfig,
  QueueCleanerConfigShape,
  SlowRuleShape,
  StallRuleShape,
} from '@/lib/cleanup/types';
import { FieldRow, isNumericActive, isRangeActive } from './field-row';
import { SizeInput } from './size-input';
import { StallRuleSummary, SlowRuleSummary } from './rule-summary';
import { useScopeOptions } from './use-scope-options';
import { jsonOk } from '@/lib/http';

interface SaveAllResponse {
  config: QueueCleanerConfigShape;
  stallRules: StallRuleShape[];
  slowRules: SlowRuleShape[];
}

interface FieldError {
  scope: 'config' | 'stall' | 'slow';
  id?: string;
  message: string;
}

interface Props {
  onDirtyChange?: (dirty: boolean) => void;
}

export function QueueCleanerTab({ onDirtyChange }: Props) {
  const [cfg, setCfg] = useState<QueueCleanerConfigShape | null>(null);
  const [stallRules, setStallRules] = useState<StallRuleShape[]>([]);
  const [slowRules, setSlowRules] = useState<SlowRuleShape[]>([]);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ kind: 'stall' | 'slow'; rule: { id: string; name: string } } | null>(null);
  const [deletingRule, setDeletingRule] = useState(false);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  const serverSnapshot = useRef<SaveAllResponse | null>(null);
  // Pinned card refs — used to scroll a newly-created rule into view.
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const scope = useScopeOptions();
  const ignoreSuggestions = useMemo<TokenSuggestionGroup[]>(() => [
    { label: 'Categories', options: scope.categories },
    { label: 'Tags', options: scope.tags },
    { label: 'Trackers', options: scope.trackerDomains },
  ], [scope.categories, scope.tags, scope.trackerDomains]);

  const isDirty = useMemo(() => {
    if (!serverSnapshot.current || !cfg) return false;
    const snap = serverSnapshot.current;
    return JSON.stringify({ config: cfg, stallRules, slowRules }) !==
      JSON.stringify({ config: snap.config, stallRules: snap.stallRules, slowRules: snap.slowRules });
  }, [cfg, stallRules, slowRules]);

  const lastReportedDirty = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastReportedDirty.current === isDirty) return;
    lastReportedDirty.current = isDirty;
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const configQuery = useQuery({
    queryKey: ['cleanup', 'queue', 'config'],
    queryFn: async ({ signal }) => {
      const [config, stallRules, slowRules] = await Promise.all([
        fetch('/api/cleanup/queue/config', { signal }).then(jsonOk<QueueCleanerConfigShape>),
        fetch('/api/cleanup/queue/stall-rules', { signal }).then(jsonOk<StallRuleShape[]>),
        fetch('/api/cleanup/queue/slow-rules', { signal }).then(jsonOk<SlowRuleShape[]>),
      ]);
      return { config, stallRules, slowRules };
    },
    staleTime: 0,
    // Don't let a focus/reconnect refetch re-seed the form mid-edit and wipe
    // unsaved changes (the seed effect below resets the dirty baseline).
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const loading = configQuery.isLoading;

  // Seed the editable form (and dirty-detection baseline) from server state.
  useEffect(() => {
    if (configQuery.data) {
      setCfg(configQuery.data.config);
      setStallRules(configQuery.data.stallRules);
      setSlowRules(configQuery.data.slowRules);
      serverSnapshot.current = configQuery.data;
      setFieldErrors([]);
    }
  }, [configQuery.data]);

  useEffect(() => {
    if (configQuery.isError) toast.error('Failed to load Queue Cleaner settings');
  }, [configQuery.isError]);

  const saveAll = async () => {
    if (!cfg) return;
    setSaving(true);
    setFieldErrors([]);
    try {
      const r = await fetch('/api/cleanup/queue/save-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg, stallRules, slowRules }),
      });
      const json = await r.json();
      if (!r.ok) {
        if (Array.isArray(json.fieldErrors)) {
          setFieldErrors(json.fieldErrors);
          // Force-expand any rule that has a field error so the user sees it.
          const failingIds = (json.fieldErrors as FieldError[])
            .filter((e) => (e.scope === 'stall' || e.scope === 'slow') && e.id)
            .map((e) => e.id!);
          if (failingIds.length > 0) {
            setEditingIds((prev) => {
              const next = new Set(prev);
              for (const id of failingIds) next.add(id);
              return next;
            });
          }
        }
        toast.error(json.error ?? 'Save failed');
        return;
      }
      setCfg(json.config);
      setStallRules(json.stallRules);
      setSlowRules(json.slowRules);
      serverSnapshot.current = json;
      // Collapse all cards on a clean save — the user is "done" editing.
      setEditingIds(new Set());
      toast.success('Queue Cleaner settings saved');
    } catch (err) {
      toast.error((err as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!serverSnapshot.current) return;
    setCfg(serverSnapshot.current.config);
    setStallRules(serverSnapshot.current.stallRules);
    setSlowRules(serverSnapshot.current.slowRules);
    setFieldErrors([]);
    setEditingIds(new Set());
  };

  const setRuleEditing = (id: string, editing: boolean) => {
    setEditingIds((prev) => {
      const next = new Set(prev);
      if (editing) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const scrollNewRuleIntoView = (id: string) => {
    // Defer until after the new card renders.
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const createStallRule = async () => {
    try {
      const r = await fetch('/api/cleanup/queue/stall-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeDefaultStall()),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast.error(j?.error ?? 'Create failed');
        return;
      }
      const created = (await r.json()) as StallRuleShape;
      // Optimistic: append locally and update the server snapshot so dirty
      // tracking knows the new rule isn't an unsaved change.
      setStallRules((prev) => [...prev, created]);
      if (serverSnapshot.current) {
        serverSnapshot.current = {
          ...serverSnapshot.current,
          stallRules: [...serverSnapshot.current.stallRules, created],
        };
      }
      setRuleEditing(created.id, true);
      scrollNewRuleIntoView(created.id);
      toast.success('Stall rule created');
    } catch (err) {
      toast.error((err as Error).message ?? 'Create failed');
    }
  };

  const createSlowRule = async () => {
    try {
      const r = await fetch('/api/cleanup/queue/slow-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeDefaultSlow()),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast.error(j?.error ?? 'Create failed');
        return;
      }
      const created = (await r.json()) as SlowRuleShape;
      setSlowRules((prev) => [...prev, created]);
      if (serverSnapshot.current) {
        serverSnapshot.current = {
          ...serverSnapshot.current,
          slowRules: [...serverSnapshot.current.slowRules, created],
        };
      }
      setRuleEditing(created.id, true);
      scrollNewRuleIntoView(created.id);
      toast.success('Slow rule created');
    } catch (err) {
      toast.error((err as Error).message ?? 'Create failed');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingRule(true);
    try {
      const path = `/api/cleanup/queue/${pendingDelete.kind}-rules/${pendingDelete.rule.id}`;
      const r = await fetch(path, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast.error(j?.error ?? 'Delete failed');
        return;
      }
      const deletedId = pendingDelete.rule.id;
      if (pendingDelete.kind === 'stall') {
        setStallRules((prev) => prev.filter((r) => r.id !== deletedId));
        if (serverSnapshot.current) {
          serverSnapshot.current = {
            ...serverSnapshot.current,
            stallRules: serverSnapshot.current.stallRules.filter((r) => r.id !== deletedId),
          };
        }
      } else {
        setSlowRules((prev) => prev.filter((r) => r.id !== deletedId));
        if (serverSnapshot.current) {
          serverSnapshot.current = {
            ...serverSnapshot.current,
            slowRules: serverSnapshot.current.slowRules.filter((r) => r.id !== deletedId),
          };
        }
      }
      cardRefs.current.delete(deletedId);
      setEditingIds((prev) => {
        if (!prev.has(deletedId)) return prev;
        const next = new Set(prev);
        next.delete(deletedId);
        return next;
      });
      setPendingDelete(null);
      toast.success('Rule deleted');
    } catch (err) {
      toast.error((err as Error).message ?? 'Delete failed');
    } finally {
      setDeletingRule(false);
    }
  };

  const configError = fieldErrors.find((e) => e.scope === 'config')?.message;
  const errorFor = (kind: 'stall' | 'slow', id: string): string | undefined =>
    fieldErrors.find((e) => e.scope === kind && e.id === id)?.message;

  if (!cfg && configQuery.isError) {
    return (
      <div className="py-12 flex flex-col items-center justify-center gap-3 text-muted-foreground">
        <span>Failed to load Queue Cleaner settings.</span>
        <Button variant="outline" size="sm" onClick={() => void configQuery.refetch()}>Retry</Button>
      </div>
    );
  }

  if (loading || !cfg) {
    return <div className="py-12 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }

  const registerCardRef = (id: string) => (el: HTMLDivElement | null) => {
    if (el) cardRefs.current.set(id, el);
    else cardRefs.current.delete(id);
  };

  return (
    <TooltipProvider delayDuration={150}>
      <div className="space-y-6 pb-32">
        {/* ── General ───────────────────────────────────────────────────── */}
        <section className="grouped-section">
          <div className="grouped-section-title">General</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Master toggle for the Queue Cleaner.</p>
              </div>
              <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
            </div>

            <div className="grouped-row grouped-row-stack-mobile gap-2">
              <div className="min-w-0 sm:flex-1">
                <Label>Auto-run mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{autoRunHint(cfg.autoRunMode)}</p>
              </div>
              <Select
                value={cfg.autoRunMode}
                onValueChange={(v) => setCfg({ ...cfg, autoRunMode: v as AutoRunMode })}
              >
                <SelectTrigger className="w-full sm:w-44 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Off</SelectItem>
                  <SelectItem value="dryRun">Dry-run (log only)</SelectItem>
                  <SelectItem value="enabled">On (real deletions)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grouped-row">
              <div className="min-w-0 flex-1">
                <Label>Run every</Label>
                <p className="text-xs text-muted-foreground mt-0.5">How often auto-run cycles fire. Manual runs are unaffected.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  type="number"
                  min={1}
                  max={10080}
                  className="w-20 sm:w-24"
                  value={cfg.intervalMinutes}
                  onChange={(e) => setCfg({ ...cfg, intervalMinutes: Math.min(10080, Math.max(1, Number(e.target.value) || 1)) })}
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
            </div>

            <div className="grouped-row">
              <div>
                <Label>Re-search after removal</Label>
                <p className="text-xs text-muted-foreground mt-0.5">When linked to Sonarr/Radarr, blocklist and trigger a new search.</p>
              </div>
              <Switch checked={cfg.reSearchAfterRemoval} onCheckedChange={(v) => setCfg({ ...cfg, reSearchAfterRemoval: v })} />
            </div>

            <div className="grouped-row">
              <div>
                <Label>Process downloads without content ID</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Affects Failed Import only. Off (recommended) skips queue items that aren&apos;t linked to a series/movie.</p>
              </div>
              <Switch checked={cfg.processNoContentId} onCheckedChange={(v) => setCfg({ ...cfg, processNoContentId: v })} />
            </div>

            <div className="grouped-row grouped-row-stacked gap-2">
              <Label>Ignored downloads</Label>
              <p className="text-xs text-muted-foreground -mt-1">Type and press Enter to add. Matches torrent hash, qBittorrent category, qBittorrent tag, or tracker domain suffix.</p>
              <TokenInput
                value={cfg.ignoredDownloads}
                onChange={(next) => setCfg({ ...cfg, ignoredDownloads: next })}
                suggestions={ignoreSuggestions}
                splitCommas={false}
                placeholder="Hash, category, tag, or tracker domain"
              />
            </div>

            <div className="grouped-row">
              <div className="min-w-0 flex-1">
                <Label>Stuck on metadata — max strikes</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Torrent state &quot;metaDL&quot;. 0 = disabled; minimum 3 strikes.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  type="number"
                  min={0}
                  className="w-20 sm:w-24"
                  value={cfg.downloadingMetadataMaxStrikes}
                  onChange={(e) => setCfg({ ...cfg, downloadingMetadataMaxStrikes: Math.max(0, Number(e.target.value) || 0) })}
                />
              </div>
            </div>
          </div>
        </section>

        {/* ── Failed Import ─────────────────────────────────────────────── */}
        <FailedImportSection cfg={cfg} setCfg={setCfg} />

        {/* ── Stall Rules ───────────────────────────────────────────────── */}
        <RuleSection
          title="Stall Rules"
          description="Strike rules for torrents in stalledDL state. Strikes reset when the torrent shows new download progress (with an optional minimum byte threshold)."
          onAdd={createStallRule}
        >
          {stallRules.length === 0 ? (
            <div className="grouped-row text-sm text-muted-foreground">No rules. Click &ldquo;Add rule&rdquo; to create one.</div>
          ) : (
            stallRules.map((rule) => {
              const editing = editingIds.has(rule.id);
              const error = errorFor('stall', rule.id);
              return (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  editing={editing || !!error}
                  onEdit={() => setRuleEditing(rule.id, true)}
                  onDone={() => setRuleEditing(rule.id, false)}
                  onChange={(next) => setStallRules((prev) => prev.map((r) => (r.id === rule.id ? next : r)))}
                  onDelete={() => setPendingDelete({ kind: 'stall', rule: { id: rule.id, name: rule.name } })}
                  summary={<StallRuleSummary rule={rule} />}
                  error={error}
                  containerRef={registerCardRef(rule.id)}
                >
                  <StallRuleFields rule={rule} onChange={(next) => setStallRules((prev) => prev.map((r) => (r.id === rule.id ? next : r)))} />
                </RuleCard>
              );
            })
          )}
        </RuleSection>

        {/* ── Slow Rules ────────────────────────────────────────────────── */}
        <RuleSection
          title="Slow Rules"
          description="Strike rules for slow downloads (speed below threshold or running longer than the configured active-time)."
          onAdd={createSlowRule}
        >
          {slowRules.length === 0 ? (
            <div className="grouped-row text-sm text-muted-foreground">No rules. Click &ldquo;Add rule&rdquo; to create one.</div>
          ) : (
            slowRules.map((rule) => {
              const editing = editingIds.has(rule.id);
              const error = errorFor('slow', rule.id);
              return (
                <RuleCard
                  key={rule.id}
                  rule={rule}
                  editing={editing || !!error}
                  onEdit={() => setRuleEditing(rule.id, true)}
                  onDone={() => setRuleEditing(rule.id, false)}
                  onChange={(next) => setSlowRules((prev) => prev.map((r) => (r.id === rule.id ? next : r)))}
                  onDelete={() => setPendingDelete({ kind: 'slow', rule: { id: rule.id, name: rule.name } })}
                  summary={<SlowRuleSummary rule={rule} />}
                  error={error}
                  containerRef={registerCardRef(rule.id)}
                >
                  <SlowRuleFields rule={rule} onChange={(next) => setSlowRules((prev) => prev.map((r) => (r.id === rule.id ? next : r)))} />
                </RuleCard>
              );
            })
          )}
        </RuleSection>

        {configError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{configError}</span>
          </div>
        )}

        {/* ── Save bar ──────────────────────────────────────────────────── */}
        <div className="fixed left-0 right-0 bottom-16 sm:bottom-0 z-30 pointer-events-none">
          <div className="max-w-screen-2xl mx-auto px-4 pb-4">
            <div
              className={
                'app-chrome-bar pointer-events-auto flex items-center justify-end gap-2 rounded-md border bg-card/95 backdrop-blur px-3 py-2 shadow-lg transition-opacity ' +
                (isDirty ? 'opacity-100' : 'opacity-0 pointer-events-none')
              }
            >
              <span className="text-xs text-muted-foreground mr-auto whitespace-nowrap hidden sm:inline">Unsaved changes</span>
              <Button variant="ghost" size="sm" onClick={discardChanges} disabled={saving}>Discard</Button>
              <Button size="sm" onClick={saveAll} disabled={saving}>
                {saving ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
                <span className="hidden sm:inline">Save all changes</span>
                <span className="sm:hidden">Save</span>
              </Button>
            </div>
          </div>
        </div>

        <ConfirmDialog
          open={!!pendingDelete}
          onOpenChange={(o) => !o && setPendingDelete(null)}
          title={pendingDelete ? `Delete rule "${pendingDelete.rule.name}"?` : ''}
          description="This deletes the rule and clears its accumulated strikes. Existing rule edits in this tab are not affected."
          confirmLabel="Delete rule"
          destructive
          busy={deletingRule}
          onConfirm={confirmDelete}
        />
      </div>
    </TooltipProvider>
  );
}

function autoRunHint(mode: AutoRunMode): string {
  switch (mode) {
    case 'disabled':
      return 'Auto-scheduler is off. Use manual runs from the Dashboard to test your rules. Recommended for new setups.';
    case 'dryRun':
      return 'The scheduler runs on the interval but only logs what it would do. Visible in History as "dryRunPreview". Strikes accumulate across cycles; a torrent\'s strikes are only cleared when it reaches max strikes and produces a dryRunPreview decision (mirroring the real-run flow).';
    case 'enabled':
      return "The scheduler will delete torrents that meet your rules on every interval. Make sure you've tested with dry-run first.";
  }
}

// ── Failed Import block ───────────────────────────────────────────────────
function FailedImportSection({ cfg, setCfg }: { cfg: QueueCleanerConfigShape; setCfg: (next: QueueCleanerConfigShape) => void }) {
  const fi = cfg.failedImport;
  const set = (partial: Partial<FailedImportConfig>) => setCfg({ ...cfg, failedImport: { ...fi, ...partial } });

  return (
    <section className="grouped-section">
      <div className="grouped-section-title">Failed Import</div>
      <div className="grouped-section-content">
        <div className="grouped-row">
          <div>
            <Label>Max strikes</Label>
            <p className="text-xs text-muted-foreground mt-0.5">0 = Failed Import handling is off. Minimum is 3 strikes when enabled.</p>
          </div>
          <Input
            type="number"
            min={0}
            className="w-24 shrink-0"
            value={fi.maxStrikes}
            onChange={(e) => set({ maxStrikes: Math.max(0, Number(e.target.value) || 0) })}
          />
        </div>

        <div className="grouped-row">
          <div className="min-w-0 flex-1">
            <Label>Pattern mode</Label>
            <p className="text-xs text-muted-foreground mt-0.5">&quot;Exclude&quot; never strikes if any message matches; &quot;Include&quot; only strikes if at least one message matches.</p>
          </div>
          <Select value={fi.patternMode} onValueChange={(v) => set({ patternMode: v as 'include' | 'exclude' })}>
            <SelectTrigger className="w-32 sm:w-36 shrink-0"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="exclude">Exclude</SelectItem>
              <SelectItem value="include">Include</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="grouped-row grouped-row-stacked gap-2">
          <Label>Patterns</Label>
          <p className="text-xs text-muted-foreground -mt-1">Type and press Enter to add. Substring match against Sonarr/Radarr status messages (case-insensitive); commas are allowed inside a pattern.</p>
          <TokenInput
            value={fi.patterns}
            onChange={(next) => set({ patterns: next })}
            splitCommas={false}
            placeholder="e.g. title mismatch"
          />
        </div>

        <div className="grouped-row">
          <div>
            <Label>Ignore private torrents</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Skip Failed Import handling entirely on private trackers.</p>
          </div>
          <Switch checked={fi.ignorePrivate} onCheckedChange={(v) => set({ ignorePrivate: v })} />
        </div>

        <div className="grouped-row">
          <div>
            <Label>Change category (instead of delete)</Label>
            <p className="text-xs text-muted-foreground mt-0.5">Tell Sonarr/Radarr to move the queue item to its post-import category. Not compatible with &quot;Delete private torrents&quot;.</p>
          </div>
          <Switch
            checked={fi.changeCategory}
            disabled={fi.deletePrivate && !fi.changeCategory}
            onCheckedChange={(v) => set({ changeCategory: v })}
          />
        </div>

        <div className="grouped-row">
          <div>
            <Label className="inline-flex items-center gap-1">
              Delete private torrents
              {fi.deletePrivate && <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />}
            </Label>
            <p className="text-xs text-muted-foreground mt-0.5">Permit deletion even on private trackers. Affects H&amp;R standing. Not compatible with &quot;Change category&quot;.</p>
          </div>
          <Switch
            checked={fi.deletePrivate}
            disabled={fi.changeCategory && !fi.deletePrivate}
            onCheckedChange={(v) => set({ deletePrivate: v })}
          />
        </div>

        {fi.deletePrivate && (
          <div className="grouped-row text-xs text-amber-600 dark:text-amber-500 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            <span>Warning: deleting private torrents can affect your tracker H&amp;R standing.</span>
          </div>
        )}
      </div>
    </section>
  );
}

// ── Generic rule section / card / shared field components ────────────────
function RuleSection({
  title,
  description,
  onAdd,
  children,
}: {
  title: string;
  description: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="grouped-section">
      <div className="grouped-section-title flex items-center justify-between">
        <span>{title}</span>
        <Button size="sm" variant="ghost" onClick={onAdd}><Plus className="w-4 h-4 mr-1" /> Add rule</Button>
      </div>
      <div className="grouped-section-content">
        <div className="px-4 py-2 text-xs text-muted-foreground border-b last:border-b-0 flex items-start gap-2">
          <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{description}</span>
        </div>
        {children}
      </div>
    </section>
  );
}

interface CommonRuleShape {
  id: string;
  name: string;
  enabled: boolean;
}

function RuleCard<R extends CommonRuleShape>({
  rule,
  editing,
  onEdit,
  onDone,
  onChange,
  onDelete,
  summary,
  error,
  children,
  containerRef,
}: {
  rule: R;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (next: R) => void;
  onDelete: () => void;
  summary: React.ReactNode;
  error: string | undefined;
  children: React.ReactNode;
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <QuickContextMenu
      label={`${rule.name || 'Untitled rule'} actions`}
      disabled={editing}
      groups={[
        {
          id: 'rule',
          actions: [
            { id: 'edit', label: 'Edit rule', icon: <Pencil />, onSelect: onEdit },
            {
              id: 'toggle',
              label: rule.enabled ? 'Turn rule off' : 'Turn rule on',
              icon: <Power />,
              onSelect: () => onChange({ ...rule, enabled: !rule.enabled }),
            },
          ],
        },
        {
          id: 'danger',
          actions: [{
            id: 'delete',
            label: 'Delete rule',
            icon: <Trash2 />,
            destructive: true,
            onSelect: onDelete,
          }],
        },
      ]}
    >
    <div
      ref={containerRef}
      className={`grouped-row grouped-row-stacked gap-3 ${error ? 'bg-destructive/5' : ''} ${!rule.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <Input
            value={rule.name}
            onChange={(e) => onChange({ ...rule, name: e.target.value })}
            placeholder="Rule name"
            className="font-medium w-full order-last sm:order-none sm:w-auto sm:max-w-xs sm:flex-1 sm:min-w-[10rem]"
            aria-invalid={!!error}
          />
        ) : (
          <div className="font-medium text-sm flex-1 min-w-0 truncate" title={rule.name}>
            {rule.name || <span className="italic text-muted-foreground">Untitled rule</span>}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <span className="text-xs text-muted-foreground">{rule.enabled ? 'On' : 'Off'}</span>
          <Switch
            checked={rule.enabled}
            onCheckedChange={(v) => onChange({ ...rule, enabled: v })}
          />
          {editing ? (
            <Button size="sm" variant="ghost" onClick={onDone} aria-label="Collapse rule">
              <ChevronUp className="w-4 h-4" />
            </Button>
          ) : (
            <Button size="sm" variant="ghost" onClick={onEdit} aria-label="Edit rule">
              <Pencil className="w-4 h-4" />
            </Button>
          )}
          <Button size="sm" variant="ghost" onClick={onDelete} aria-label="Delete rule">
            <Trash2 className="w-4 h-4" />
          </Button>
        </div>
      </div>
      {editing ? children : summary}
      {error && (
        <div className="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
    </QuickContextMenu>
  );
}

function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">{children}</div>;
}

function PercentRange({ min, max, onChange }: { min: number; max: number; onChange: (min: number, max: number) => void }) {
  return (
    <div className="flex items-center gap-2">
      <Input
        type="number"
        min={0}
        max={100}
        className="w-20"
        value={min}
        onChange={(e) => onChange(Math.max(0, Math.min(100, Number(e.target.value) || 0)), max)}
      />
      <span className="text-xs text-muted-foreground">to</span>
      <Input
        type="number"
        min={1}
        max={100}
        className="w-20"
        value={max}
        onChange={(e) => onChange(min, Math.max(1, Math.min(100, Number(e.target.value) || 100)))}
      />
      <span className="text-xs text-muted-foreground">%</span>
    </div>
  );
}

function PrivacySelect({ value, onChange }: { value: 'public' | 'private' | 'both'; onChange: (v: 'public' | 'private' | 'both') => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as 'public' | 'private' | 'both')}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="public">Public only</SelectItem>
        <SelectItem value="private">Private only</SelectItem>
        <SelectItem value="both">Public &amp; private</SelectItem>
      </SelectContent>
    </Select>
  );
}

// ── Stall rule fields ────────────────────────────────────────────────────
function StallRuleFields({ rule, onChange }: { rule: StallRuleShape; onChange: (next: StallRuleShape) => void }) {
  return (
    <FieldGrid>
      <FieldRow label="Max strikes" hint="Minimum 3. Lower values risk false-positive removals." active>
        <Input
          type="number"
          min={3}
          value={rule.maxStrikes}
          onChange={(e) => onChange({ ...rule, maxStrikes: Math.max(3, Number(e.target.value) || 3) })}
        />
      </FieldRow>
      <FieldRow label="Privacy scope" hint="Limit this rule to public, private, or both kinds of torrents." active>
        <PrivacySelect value={rule.privacyType} onChange={(v) => onChange({ ...rule, privacyType: v })} />
      </FieldRow>
      <FieldRow
        label="Completion % range"
        hint="Rule only applies when the torrent's progress is in this range."
        active={isRangeActive(rule.minCompletionPercentage, rule.maxCompletionPercentage)}
      >
        <PercentRange
          min={rule.minCompletionPercentage}
          max={rule.maxCompletionPercentage}
          onChange={(min, max) => onChange({ ...rule, minCompletionPercentage: min, maxCompletionPercentage: max })}
        />
      </FieldRow>
      <FieldRow label="Priority" hint="Lower number = evaluated first. First matching rule wins." active={rule.priority !== 0}>
        <Input
          type="number"
          value={rule.priority}
          onChange={(e) => onChange({ ...rule, priority: Number(e.target.value) || 0 })}
        />
      </FieldRow>
      <FieldRow label="Reset strikes on progress" hint="Clears accumulated strikes when the torrent shows new download bytes." active={rule.resetStrikesOnProgress}>
        <Switch checked={rule.resetStrikesOnProgress} onCheckedChange={(v) => onChange({ ...rule, resetStrikesOnProgress: v })} />
      </FieldRow>
      <FieldRow
        label="Minimum progress to reset"
        hint="Leave blank for &quot;any progress counts&quot;. Pick KB / MB / GB."
        active={isNumericActive(rule.minimumProgressBytes, -1) && rule.minimumProgressBytes !== 0}
      >
        <SizeInput
          bytes={rule.minimumProgressBytes}
          onChange={(b) => onChange({ ...rule, minimumProgressBytes: b })}
          placeholder="(any progress)"
          defaultUnit="MB"
        />
      </FieldRow>
      <FieldRow label="Change category on removal" hint="Tells the arr to move the queue item rather than delete. Disables 'Delete private from client'." active={rule.changeCategory}>
        <Switch
          checked={rule.changeCategory}
          disabled={rule.deletePrivate && !rule.changeCategory}
          onCheckedChange={(v) => onChange({ ...rule, changeCategory: v })}
        />
      </FieldRow>
      <FieldRow label="Delete private from client" hint="Permit deletion of private torrents — affects H&R standing." active={rule.deletePrivate}>
        <Switch
          checked={rule.deletePrivate}
          disabled={rule.changeCategory && !rule.deletePrivate}
          onCheckedChange={(v) => onChange({ ...rule, deletePrivate: v })}
        />
      </FieldRow>
      <FieldRow
        label="Re-search override"
        hint="Override the global &quot;Re-search after removal&quot; for matches of this rule. Not applied when &quot;Change category&quot; is on."
        active={rule.reSearchOverride !== null}
      >
        <Select
          value={rule.reSearchOverride === null ? 'inherit' : rule.reSearchOverride ? 'true' : 'false'}
          onValueChange={(v) => onChange({ ...rule, reSearchOverride: v === 'inherit' ? null : v === 'true' })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit global</SelectItem>
            <SelectItem value="true">Always re-search</SelectItem>
            <SelectItem value="false">Never re-search</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
    </FieldGrid>
  );
}

// ── Slow rule fields ─────────────────────────────────────────────────────
function SlowRuleFields({ rule, onChange }: { rule: SlowRuleShape; onChange: (next: SlowRuleShape) => void }) {
  return (
    <FieldGrid>
      <FieldRow label="Max strikes" hint="Minimum 3." active>
        <Input
          type="number"
          min={3}
          value={rule.maxStrikes}
          onChange={(e) => onChange({ ...rule, maxStrikes: Math.max(3, Number(e.target.value) || 3) })}
        />
      </FieldRow>
      <FieldRow label="Privacy scope" active>
        <PrivacySelect value={rule.privacyType} onChange={(v) => onChange({ ...rule, privacyType: v })} />
      </FieldRow>
      <FieldRow
        label="Min speed (KB/s)"
        hint="Strikes when download speed is below this. Blank = disabled."
        active={isNumericActive(rule.minSpeedKbps)}
      >
        <Input
          type="number"
          min={0}
          value={rule.minSpeedKbps ?? ''}
          placeholder="(disabled)"
          onChange={(e) => onChange({ ...rule, minSpeedKbps: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
        />
      </FieldRow>
      <FieldRow
        label="Max active hours"
        hint="Strikes when actively downloading for longer than this. Pause time is excluded."
        active={isNumericActive(rule.maxTimeHours)}
      >
        <Input
          type="number"
          min={0}
          step={0.5}
          value={rule.maxTimeHours ?? ''}
          placeholder="(disabled)"
          onChange={(e) => onChange({ ...rule, maxTimeHours: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })}
        />
      </FieldRow>
      <FieldRow
        label="Completion % range"
        active={isRangeActive(rule.minCompletionPercentage, rule.maxCompletionPercentage)}
      >
        <PercentRange
          min={rule.minCompletionPercentage}
          max={rule.maxCompletionPercentage}
          onChange={(min, max) => onChange({ ...rule, minCompletionPercentage: min, maxCompletionPercentage: max })}
        />
      </FieldRow>
      <FieldRow
        label="Ignore torrents larger than"
        hint="Torrents above this size are exempt. Blank = no limit. Pick KB / MB / GB."
        active={isNumericActive(rule.ignoreAboveSizeBytes, -1) && rule.ignoreAboveSizeBytes !== 0}
      >
        <SizeInput
          bytes={rule.ignoreAboveSizeBytes}
          onChange={(b) => onChange({ ...rule, ignoreAboveSizeBytes: b })}
          placeholder="(no limit)"
          defaultUnit="GB"
        />
      </FieldRow>
      <FieldRow label="Priority" hint="Lower number = evaluated first." active={rule.priority !== 0}>
        <Input
          type="number"
          value={rule.priority}
          onChange={(e) => onChange({ ...rule, priority: Number(e.target.value) || 0 })}
        />
      </FieldRow>
      <FieldRow label="Reset strikes on speed recovery" hint="Clears accumulated strikes if speed climbs back over the threshold. Requires a Min speed value." active={rule.resetStrikesOnProgress}>
        <Switch checked={rule.resetStrikesOnProgress} disabled={rule.minSpeedKbps == null} onCheckedChange={(v) => onChange({ ...rule, resetStrikesOnProgress: v })} />
      </FieldRow>
      <FieldRow label="Change category on removal" active={rule.changeCategory}>
        <Switch
          checked={rule.changeCategory}
          disabled={rule.deletePrivate && !rule.changeCategory}
          onCheckedChange={(v) => onChange({ ...rule, changeCategory: v })}
        />
      </FieldRow>
      <FieldRow label="Delete private from client" active={rule.deletePrivate}>
        <Switch
          checked={rule.deletePrivate}
          disabled={rule.changeCategory && !rule.deletePrivate}
          onCheckedChange={(v) => onChange({ ...rule, deletePrivate: v })}
        />
      </FieldRow>
      <FieldRow
        label="Re-search override"
        hint="Override the global &quot;Re-search after removal&quot; for matches of this rule. Not applied when &quot;Change category&quot; is on."
        active={rule.reSearchOverride !== null}
      >
        <Select
          value={rule.reSearchOverride === null ? 'inherit' : rule.reSearchOverride ? 'true' : 'false'}
          onValueChange={(v) => onChange({ ...rule, reSearchOverride: v === 'inherit' ? null : v === 'true' })}
        >
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit global</SelectItem>
            <SelectItem value="true">Always re-search</SelectItem>
            <SelectItem value="false">Never re-search</SelectItem>
          </SelectContent>
        </Select>
      </FieldRow>
    </FieldGrid>
  );
}

function makeDefaultStall(): Omit<StallRuleShape, 'id'> {
  return {
    name: 'Stall rule',
    enabled: true,
    priority: 0,
    maxStrikes: 3,
    privacyType: 'public',
    minCompletionPercentage: 0,
    maxCompletionPercentage: 100,
    resetStrikesOnProgress: true,
    minimumProgressBytes: null,
    changeCategory: false,
    deletePrivate: false,
    reSearchOverride: null,
  };
}

function makeDefaultSlow(): Omit<SlowRuleShape, 'id'> {
  return {
    name: 'Slow rule',
    enabled: true,
    priority: 0,
    maxStrikes: 3,
    privacyType: 'public',
    minCompletionPercentage: 0,
    maxCompletionPercentage: 100,
    minSpeedKbps: 100,
    maxTimeHours: null,
    ignoreAboveSizeBytes: null,
    resetStrikesOnProgress: true,
    changeCategory: false,
    deletePrivate: false,
    reSearchOverride: null,
  };
}
