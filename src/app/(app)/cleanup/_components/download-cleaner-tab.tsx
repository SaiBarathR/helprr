'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { TokenInput } from '@/components/ui/token-input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TooltipProvider } from '@/components/ui/tooltip';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Loader2, Plus, Save, Trash2, AlertTriangle, Info, Pencil, ChevronUp } from 'lucide-react';
import type {
  AutoRunMode,
  DownloadCleanerConfigShape,
  SeedingRuleShape,
} from '@/lib/cleanup/types';
import { FieldRow, isArrayActive, isNumericActive } from './field-row';
import { SeedingRuleSummary } from './rule-summary';
import { jsonOk } from '@/lib/http';

const COMMON_CATEGORIES = ['sonarr', 'radarr', 'tv-sonarr'] as const;

interface SaveAllResponse {
  config: DownloadCleanerConfigShape;
  seedingRules: SeedingRuleShape[];
}

interface FieldError {
  scope: 'config' | 'rule';
  id?: string;
  message: string;
}

interface Props {
  onDirtyChange?: (dirty: boolean) => void;
}

export function DownloadCleanerTab({ onDirtyChange }: Props) {
  const [cfg, setCfg] = useState<DownloadCleanerConfigShape | null>(null);
  const [rules, setRules] = useState<SeedingRuleShape[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingRule, setDeletingRule] = useState(false);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  const serverSnapshot = useRef<SaveAllResponse | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const isDirty = useMemo(() => {
    if (!serverSnapshot.current || !cfg) return false;
    const snap = serverSnapshot.current;
    return JSON.stringify({ config: cfg, seedingRules: rules }) !==
      JSON.stringify({ config: snap.config, seedingRules: snap.seedingRules });
  }, [cfg, rules]);

  const lastReportedDirty = useRef<boolean | null>(null);
  useEffect(() => {
    if (lastReportedDirty.current === isDirty) return;
    lastReportedDirty.current = isDirty;
    onDirtyChange?.(isDirty);
  }, [isDirty, onDirtyChange]);

  const refresh = useCallback(async () => {
    setLoading(true);
    setFieldErrors([]);
    try {
      const [cfgR, rulesR] = await Promise.all([
        fetch('/api/cleanup/download/config').then(jsonOk<DownloadCleanerConfigShape>),
        fetch('/api/cleanup/download/seeding-rules').then(jsonOk<SeedingRuleShape[]>),
      ]);
      setCfg(cfgR);
      setRules(rulesR);
      serverSnapshot.current = { config: cfgR, seedingRules: rulesR };
    } catch {
      toast.error('Failed to load Download Cleaner settings');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveAll = async () => {
    if (!cfg) return;
    setSaving(true);
    setFieldErrors([]);
    try {
      const r = await fetch('/api/cleanup/download/save-all', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ config: cfg, seedingRules: rules }),
      });
      const json = await r.json();
      if (!r.ok) {
        if (Array.isArray(json.fieldErrors)) {
          setFieldErrors(json.fieldErrors);
          const failingIds = (json.fieldErrors as FieldError[])
            .filter((e) => e.scope === 'rule' && e.id)
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
      setRules(json.seedingRules);
      serverSnapshot.current = json;
      setEditingIds(new Set());
      toast.success('Download Cleaner settings saved');
    } catch (err) {
      toast.error((err as Error).message ?? 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const discardChanges = () => {
    if (!serverSnapshot.current) return;
    setCfg(serverSnapshot.current.config);
    setRules(serverSnapshot.current.seedingRules);
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
    requestAnimationFrame(() => {
      const el = cardRefs.current.get(id);
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  };

  const createRule = async () => {
    try {
      const r = await fetch('/api/cleanup/download/seeding-rules', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(makeDefaultSeeding()),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast.error(j?.error ?? 'Create failed');
        return;
      }
      const created = (await r.json()) as SeedingRuleShape;
      setRules((prev) => [...prev, created]);
      if (serverSnapshot.current) {
        serverSnapshot.current = {
          ...serverSnapshot.current,
          seedingRules: [...serverSnapshot.current.seedingRules, created],
        };
      }
      setRuleEditing(created.id, true);
      scrollNewRuleIntoView(created.id);
      toast.success('Seeding rule created');
    } catch (err) {
      toast.error((err as Error).message ?? 'Create failed');
    }
  };

  const confirmDelete = async () => {
    if (!pendingDelete) return;
    setDeletingRule(true);
    try {
      const r = await fetch(`/api/cleanup/download/seeding-rules/${pendingDelete.id}`, { method: 'DELETE' });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        toast.error(j?.error ?? 'Delete failed');
        return;
      }
      const deletedId = pendingDelete.id;
      setRules((prev) => prev.filter((r) => r.id !== deletedId));
      if (serverSnapshot.current) {
        serverSnapshot.current = {
          ...serverSnapshot.current,
          seedingRules: serverSnapshot.current.seedingRules.filter((r) => r.id !== deletedId),
        };
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
  const errorFor = (id: string): string | undefined =>
    fieldErrors.find((e) => e.scope === 'rule' && e.id === id)?.message;

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
                <p className="text-xs text-muted-foreground mt-0.5">Master toggle for the Download Cleaner.</p>
              </div>
              <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
            </div>

            <div className="grouped-row">
              <div>
                <Label>Auto-run mode</Label>
                <p className="text-xs text-muted-foreground mt-0.5">{autoRunHint(cfg.autoRunMode)}</p>
              </div>
              <Select
                value={cfg.autoRunMode}
                onValueChange={(v) => setCfg({ ...cfg, autoRunMode: v as AutoRunMode })}
              >
                <SelectTrigger className="w-44 shrink-0"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="disabled">Off</SelectItem>
                  <SelectItem value="dryRun">Dry-run (log only)</SelectItem>
                  <SelectItem value="enabled">On (real deletions)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grouped-row">
              <div>
                <Label>Run every</Label>
                <p className="text-xs text-muted-foreground mt-0.5">How often auto-run cycles fire. Manual runs are unaffected.</p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <Input
                  type="number"
                  min={1}
                  className="w-24"
                  value={cfg.intervalMinutes}
                  onChange={(e) => setCfg({ ...cfg, intervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
            </div>

            <div className="grouped-row flex-col items-stretch gap-2">
              <Label>Ignored downloads</Label>
              <p className="text-xs text-muted-foreground -mt-1">One per line. Matches torrent hash, qBittorrent category, qBittorrent tag, or tracker domain suffix.</p>
              <Textarea
                value={cfg.ignoredDownloads.join('\n')}
                onChange={(e) => setCfg({ ...cfg, ignoredDownloads: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
                placeholder={'aabbccdd00112233\nprivate-tracker.example.org'}
                className="font-mono text-sm min-h-[88px]"
              />
            </div>
          </div>
        </section>

        {/* ── Auto-remove imported ──────────────────────────────────────── */}
        <section className="grouped-section">
          <div className="grouped-section-title">Auto-remove imported downloads</div>
          <div className="grouped-section-content">
            <div className="grouped-row">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Removes torrents in the listed categories as soon as Sonarr/Radarr finish importing them. Managed internally as a hidden system rule.</p>
              </div>
              <Switch checked={cfg.autoRemoveImportedEnabled}
                onCheckedChange={(v) => setCfg({ ...cfg, autoRemoveImportedEnabled: v })} />
            </div>
            <div className="grouped-row flex-col items-stretch gap-2">
              <Label>Categories</Label>
              <p className="text-xs text-muted-foreground -mt-1">qBittorrent categories. Required when this section is on.</p>
              <TokenInput
                value={cfg.autoRemoveImportedCategories}
                onChange={(next) => setCfg({ ...cfg, autoRemoveImportedCategories: next })}
                placeholder="sonarr, radarr, tv-sonarr"
                aria-invalid={cfg.autoRemoveImportedEnabled && cfg.autoRemoveImportedCategories.length === 0}
                disabled={!cfg.autoRemoveImportedEnabled}
              />
              <CommonCategoryChips
                disabled={!cfg.autoRemoveImportedEnabled}
                present={cfg.autoRemoveImportedCategories}
                onAdd={(cat) =>
                  setCfg({
                    ...cfg,
                    autoRemoveImportedCategories: [...cfg.autoRemoveImportedCategories, cat],
                  })
                }
              />
            </div>
            <div className="grouped-row">
              <div>
                <Label>Delete files</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Also delete the source files on disk. Off keeps the files and only removes from qBittorrent.</p>
              </div>
              <Switch checked={cfg.autoRemoveImportedDeleteFiles}
                onCheckedChange={(v) => setCfg({ ...cfg, autoRemoveImportedDeleteFiles: v })}
                disabled={!cfg.autoRemoveImportedEnabled} />
            </div>
          </div>
        </section>

        {/* ── Seeding rules ─────────────────────────────────────────────── */}
        <section className="grouped-section">
          <div className="grouped-section-title flex items-center justify-between">
            <span>Seeding rules</span>
            <Button size="sm" variant="ghost" onClick={createRule}><Plus className="w-4 h-4 mr-1" /> Add rule</Button>
          </div>
          <div className="grouped-section-content">
            <div className="px-4 py-2 text-xs text-muted-foreground border-b last:border-b-0 flex items-start gap-2">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>Applied to fully-downloaded, seeding torrents. Removal happens when (ratio ≥ Max ratio AND seeded ≥ Min seed time) OR seeded ≥ Max seed time. First matching rule wins (by priority).</span>
            </div>
            {rules.length === 0 ? (
              <div className="grouped-row text-sm text-muted-foreground">No rules. Click &ldquo;Add rule&rdquo; to create one.</div>
            ) : (
              rules.map((rule) => {
                const editing = editingIds.has(rule.id);
                const error = errorFor(rule.id);
                return (
                  <SeedingRuleCard
                    key={rule.id}
                    rule={rule}
                    editing={editing || !!error}
                    onEdit={() => setRuleEditing(rule.id, true)}
                    onDone={() => setRuleEditing(rule.id, false)}
                    onChange={(next) => setRules((prev) => prev.map((r) => (r.id === rule.id ? next : r)))}
                    onDelete={() => setPendingDelete({ id: rule.id, name: rule.name })}
                    error={error}
                    containerRef={registerCardRef(rule.id)}
                  />
                );
              })
            )}
          </div>
        </section>

        {configError && (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{configError}</span>
          </div>
        )}

        <div className="fixed left-0 right-0 bottom-16 sm:bottom-0 z-30 pointer-events-none">
          <div className="max-w-screen-2xl mx-auto px-4 pb-4">
            <div
              className={
                'pointer-events-auto flex items-center justify-end gap-2 rounded-md border bg-card/95 backdrop-blur px-3 py-2 shadow-lg transition-opacity ' +
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
          title={pendingDelete ? `Delete rule "${pendingDelete.name}"?` : ''}
          description="This deletes the seeding rule. Existing rule edits in this tab are not affected."
          confirmLabel="Delete rule"
          destructive
          busy={deletingRule}
          onConfirm={confirmDelete}
        />
      </div>
    </TooltipProvider>
  );
}

function CommonCategoryChips({
  present,
  onAdd,
  disabled,
}: {
  present: string[];
  onAdd: (cat: string) => void;
  disabled?: boolean;
}) {
  const lower = present.map((c) => c.toLowerCase());
  const missing = COMMON_CATEGORIES.filter((c) => !lower.includes(c));
  if (missing.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-0.5">
      <span className="text-[11px] text-muted-foreground self-center">Quick add:</span>
      {missing.map((c) => (
        <button
          key={c}
          type="button"
          disabled={disabled}
          onClick={() => onAdd(c)}
          className="text-[11px] font-medium rounded-full border border-dashed border-muted-foreground/30 px-2 py-0.5 hover:bg-muted/40 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          + {c}
        </button>
      ))}
    </div>
  );
}

function autoRunHint(mode: AutoRunMode): string {
  switch (mode) {
    case 'disabled':
      return 'Auto-scheduler is off. Use manual runs from the Dashboard to test your rules. Recommended for new setups.';
    case 'dryRun':
      return 'The scheduler runs on the interval but only logs what it would do. Visible in History as "dryRunPreview".';
    case 'enabled':
      return "The scheduler will delete torrents that meet your rules on every interval. Make sure you've tested with dry-run first.";
  }
}

function SeedingRuleCard({
  rule,
  editing,
  onEdit,
  onDone,
  onChange,
  onDelete,
  error,
  containerRef,
}: {
  rule: SeedingRuleShape;
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onChange: (next: SeedingRuleShape) => void;
  onDelete: () => void;
  error: string | undefined;
  containerRef?: (el: HTMLDivElement | null) => void;
}) {
  return (
    <div
      ref={containerRef}
      className={`grouped-row flex-col items-stretch gap-3 ${error ? 'bg-destructive/5' : ''} ${!rule.enabled ? 'opacity-60' : ''}`}
    >
      <div className="flex items-center gap-2 flex-wrap">
        {editing ? (
          <Input
            value={rule.name}
            onChange={(e) => onChange({ ...rule, name: e.target.value })}
            placeholder="Rule name"
            className="font-medium max-w-xs flex-1 min-w-[10rem]"
            aria-invalid={!!error}
          />
        ) : (
          <div className="font-medium text-sm flex-1 min-w-0 truncate" title={rule.name}>
            {rule.name || <span className="italic text-muted-foreground">Untitled rule</span>}
          </div>
        )}
        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <span className="text-xs text-muted-foreground">{rule.enabled ? 'On' : 'Off'}</span>
          <Switch checked={rule.enabled} onCheckedChange={(v) => onChange({ ...rule, enabled: v })} />
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

      {editing ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
          <FieldRow
            label="Categories"
            hint="qBittorrent categories. Empty = applies to all categories."
            active={isArrayActive(rule.categories)}
          >
            <TokenInput
              value={rule.categories}
              onChange={(next) => onChange({ ...rule, categories: next })}
              placeholder="sonarr, radarr, tv-sonarr"
            />
            <CommonCategoryChips
              present={rule.categories}
              onAdd={(cat) => onChange({ ...rule, categories: [...rule.categories, cat] })}
            />
          </FieldRow>
          <FieldRow
            label="Tracker patterns"
            hint="Domain suffixes (e.g. example.org). Empty = any tracker."
            active={isArrayActive(rule.trackerPatterns)}
          >
            <TokenInput
              value={rule.trackerPatterns}
              onChange={(next) => onChange({ ...rule, trackerPatterns: next })}
              placeholder="example.org, tracker.private.tld"
            />
          </FieldRow>
          <FieldRow
            label="Tags — match any"
            hint="Rule matches if torrent has at least one of these qBit tags."
            active={isArrayActive(rule.tagsAny)}
          >
            <TokenInput
              value={rule.tagsAny}
              onChange={(next) => onChange({ ...rule, tagsAny: next })}
              placeholder="tag-a, tag-b"
            />
          </FieldRow>
          <FieldRow
            label="Tags — match all"
            hint="Rule matches only if torrent has all these qBit tags."
            active={isArrayActive(rule.tagsAll)}
          >
            <TokenInput
              value={rule.tagsAll}
              onChange={(next) => onChange({ ...rule, tagsAll: next })}
              placeholder="tag-x, tag-y"
            />
          </FieldRow>
          <FieldRow label="Privacy scope" hint="Limit to public, private, or both kinds of torrents." active>
            <Select value={rule.privacyType} onValueChange={(v) => onChange({ ...rule, privacyType: v as 'public' | 'private' | 'both' })}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="public">Public only</SelectItem>
                <SelectItem value="private">Private only</SelectItem>
                <SelectItem value="both">Public &amp; private</SelectItem>
              </SelectContent>
            </Select>
          </FieldRow>
          <FieldRow label="Priority" hint="Lower number = evaluated first. First matching rule wins." active={rule.priority !== 0}>
            <Input
              type="number"
              value={rule.priority}
              onChange={(e) => onChange({ ...rule, priority: Number(e.target.value) || 0 })}
            />
          </FieldRow>
          <FieldRow
            label="Max ratio"
            hint="-1 disables the ratio check. Use with Min seed time below."
            active={isNumericActive(rule.maxRatio)}
          >
            <Input
              type="number"
              step={0.1}
              value={rule.maxRatio}
              onChange={(e) => onChange({ ...rule, maxRatio: Number(e.target.value) })}
            />
          </FieldRow>
          <FieldRow
            label="Min seed time (hours)"
            hint="Used together with Max ratio (both must be met for ratio-based removal)."
            active={rule.minSeedTimeHours > 0}
          >
            <Input
              type="number"
              min={0}
              step={0.5}
              value={rule.minSeedTimeHours}
              onChange={(e) => onChange({ ...rule, minSeedTimeHours: Math.max(0, Number(e.target.value) || 0) })}
            />
          </FieldRow>
          <FieldRow
            label="Max seed time (hours)"
            hint="-1 disables. When met, removes regardless of ratio."
            active={isNumericActive(rule.maxSeedTimeHours)}
          >
            <Input
              type="number"
              step={0.5}
              value={rule.maxSeedTimeHours}
              onChange={(e) => onChange({ ...rule, maxSeedTimeHours: Number(e.target.value) })}
            />
          </FieldRow>
          <FieldRow
            label="Delete source files"
            hint="Also delete the files on disk. Off only removes from qBittorrent."
            active={rule.deleteSourceFiles}
          >
            <Switch checked={rule.deleteSourceFiles} onCheckedChange={(v) => onChange({ ...rule, deleteSourceFiles: v })} />
          </FieldRow>
        </div>
      ) : (
        <SeedingRuleSummary rule={rule} />
      )}

      {error && (
        <div className="text-xs text-destructive flex items-start gap-1.5">
          <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}

function makeDefaultSeeding(): Omit<SeedingRuleShape, 'id' | 'isSystem'> {
  return {
    name: 'Seeding rule',
    enabled: true,
    priority: 0,
    categories: [],
    trackerPatterns: [],
    tagsAny: [],
    tagsAll: [],
    privacyType: 'both',
    maxRatio: -1,
    minSeedTimeHours: 0,
    maxSeedTimeHours: -1,
    deleteSourceFiles: true,
  };
}
