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
  DownloadCleanerConfigShape,
  SeedingRuleShape,
} from '@/lib/cleanup/types';
import { FieldRow, isArrayActive, isNumericActive } from './field-row';
import { SeedingRuleSummary } from './rule-summary';
import { useScopeOptions } from './use-scope-options';
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
  const [saving, setSaving] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<FieldError[]>([]);
  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [deletingRule, setDeletingRule] = useState(false);
  const [editingIds, setEditingIds] = useState<Set<string>>(new Set());

  const serverSnapshot = useRef<SaveAllResponse | null>(null);
  const cardRefs = useRef<Map<string, HTMLDivElement>>(new Map());

  const scope = useScopeOptions();
  // Live qBit categories when reachable; the usual *arr defaults otherwise.
  const categorySuggestions = scope.categories.length > 0 ? scope.categories : [...COMMON_CATEGORIES];
  const ignoreSuggestions = useMemo<TokenSuggestionGroup[]>(() => [
    { label: 'Categories', options: scope.categories },
    { label: 'Tags', options: scope.tags },
    { label: 'Trackers', options: scope.trackerDomains },
  ], [scope.categories, scope.tags, scope.trackerDomains]);

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

  const configQuery = useQuery({
    queryKey: ['cleanup', 'download', 'config'],
    queryFn: async ({ signal }) => {
      const [config, seedingRules] = await Promise.all([
        fetch('/api/cleanup/download/config', { signal }).then(jsonOk<DownloadCleanerConfigShape>),
        fetch('/api/cleanup/download/seeding-rules', { signal }).then(jsonOk<SeedingRuleShape[]>),
      ]);
      return { config, seedingRules };
    },
    staleTime: 0,
    // Don't let a focus/reconnect refetch re-seed the form mid-edit and wipe
    // unsaved changes (the seed effect below resets the dirty baseline).
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
  const loading = configQuery.isLoading;

  // Seed the editable form (and the dirty-detection baseline) from server state
  // whenever it arrives — mirrors the old refresh-on-mount.
  useEffect(() => {
    if (configQuery.data) {
      setCfg(configQuery.data.config);
      setRules(configQuery.data.seedingRules);
      serverSnapshot.current = configQuery.data;
      setFieldErrors([]);
    }
  }, [configQuery.data]);

  useEffect(() => {
    if (configQuery.isError) toast.error('Failed to load Download Cleaner settings');
  }, [configQuery.isError]);

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
      serverSnapshot.current = { config: json.config, seedingRules: json.seedingRules };
      setEditingIds(new Set());
      toast.success('Download Cleaner settings saved');
      if (json.globalAutoRemoveDisabled) {
        toast.info('Global "Auto-remove imported" was turned off because a rule now uses per-rule import confirmation.');
      }
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
      const json = (await r.json()) as SeedingRuleShape & { globalAutoRemoveDisabled?: boolean };
      const { globalAutoRemoveDisabled, ...created } = json;
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
      if (globalAutoRemoveDisabled) {
        toast.info('Global "Auto-remove imported" was turned off because this rule uses per-rule import confirmation.');
        // Reflect the server-side flip locally so the section disables.
        setCfg((prev) => (prev ? { ...prev, autoRemoveImportedEnabled: false } : prev));
        // Keep the snapshot in sync so the dirty-detection memo doesn't fire
        // on a flip the server already persisted.
        if (serverSnapshot.current) {
          serverSnapshot.current = {
            ...serverSnapshot.current,
            config: { ...serverSnapshot.current.config, autoRemoveImportedEnabled: false },
          };
        }
      }
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

  // Rule-level `requireImportedConfirmation` and the global toggle are
  // mutually exclusive. Surface any enabled user rule with the flag set so
  // the section can disable its controls and the global Switch.
  const ruleLevelConflicts = useMemo(
    () => rules.filter((r) => r.enabled && r.requireImportedConfirmation),
    [rules],
  );

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
                  className="w-20 sm:w-24"
                  value={cfg.intervalMinutes}
                  onChange={(e) => setCfg({ ...cfg, intervalMinutes: Math.max(1, Number(e.target.value) || 1) })}
                />
                <span className="text-sm text-muted-foreground">min</span>
              </div>
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
          </div>
        </section>

        {/* ── Auto-remove imported ──────────────────────────────────────── */}
        <section className="grouped-section">
          <div className="grouped-section-title">Auto-remove imported downloads</div>
          <div className="grouped-section-content">
            {ruleLevelConflicts.length > 0 && (
              <div className="px-4 py-3 text-xs text-muted-foreground border-b last:border-b-0 flex items-start gap-2 bg-muted/30">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  Disabled — {ruleLevelConflicts.length} rule{ruleLevelConflicts.length === 1 ? '' : 's'} ({ruleLevelConflicts.map((r) => r.name).join(', ')}) use rule-level import confirmation. Turn that off on those rules first to use this section.
                </span>
              </div>
            )}
            <div className="grouped-row">
              <div>
                <Label>Enabled</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Removes torrents in the listed categories as soon as Sonarr/Radarr finish importing them. Managed internally as a hidden system rule. Mutually exclusive with rule-level import confirmation.</p>
              </div>
              <Switch
                checked={cfg.autoRemoveImportedEnabled}
                disabled={ruleLevelConflicts.length > 0}
                onCheckedChange={(v) => {
                  if (v && ruleLevelConflicts.length > 0) {
                    toast.error('Disable rule-level import confirmation on existing rules first.');
                    return;
                  }
                  setCfg({ ...cfg, autoRemoveImportedEnabled: v });
                }}
              />
            </div>
            <div className="grouped-row grouped-row-stacked gap-2">
              <Label>Categories</Label>
              <p className="text-xs text-muted-foreground -mt-1">qBittorrent categories. Required when this section is on.</p>
              <TokenInput
                value={cfg.autoRemoveImportedCategories}
                onChange={(next) => setCfg({ ...cfg, autoRemoveImportedCategories: next })}
                suggestions={categorySuggestions}
                placeholder="Type or pick a category"
                aria-invalid={cfg.autoRemoveImportedEnabled && cfg.autoRemoveImportedCategories.length === 0}
                disabled={!cfg.autoRemoveImportedEnabled}
              />
            </div>
            <div className="grouped-row grouped-row-stack-mobile gap-2">
              <div className="min-w-0 sm:flex-1">
                <Label>Tracker privacy</Label>
                <p className="text-xs text-muted-foreground mt-0.5">Which trackers this applies to. Default Public — opt in to Private only if your tracker permits early-deletes (most do not).</p>
              </div>
              <Select
                value={cfg.autoRemoveImportedPrivacyType}
                onValueChange={(v) => setCfg({ ...cfg, autoRemoveImportedPrivacyType: v as 'public' | 'private' | 'both' })}
                disabled={!cfg.autoRemoveImportedEnabled}
              >
                <SelectTrigger className="w-full sm:w-48"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="public">Public only</SelectItem>
                  <SelectItem value="private">Private only</SelectItem>
                  <SelectItem value="both">Public &amp; private</SelectItem>
                </SelectContent>
              </Select>
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
  // Shared react-query cache — every card reads the same scope-options fetch.
  const scope = useScopeOptions();
  const categorySuggestions = scope.categories.length > 0 ? scope.categories : [...COMMON_CATEGORIES];
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
              suggestions={categorySuggestions}
              placeholder="Type or pick a category"
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
              suggestions={scope.trackerDomains}
              placeholder="Type or pick a tracker domain"
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
              suggestions={scope.tags}
              placeholder="Type or pick a tag"
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
              suggestions={scope.tags}
              placeholder="Type or pick a tag"
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
          <FieldRow
            label="Require import confirmation"
            hint="Only delete after Sonarr/Radarr confirms a successful import. Saving this on will turn off the global 'Auto-remove imported' toggle (mutually exclusive)."
            active={rule.requireImportedConfirmation}
          >
            <Switch
              checked={rule.requireImportedConfirmation}
              onCheckedChange={(v) => onChange({ ...rule, requireImportedConfirmation: v })}
            />
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
    </QuickContextMenu>
  );
}

function makeDefaultSeeding(): Omit<SeedingRuleShape, 'id' | 'isSystem'> {
  return {
    name: 'Seeding rule',
    enabled: true,
    priority: 0,
    // The validator now rejects a rule with no category/tracker/tag filter,
    // so seed a sensible default the user can adjust.
    categories: ['sonarr'],
    trackerPatterns: [],
    tagsAny: [],
    tagsAll: [],
    privacyType: 'both',
    maxRatio: -1,
    minSeedTimeHours: 0,
    maxSeedTimeHours: -1,
    deleteSourceFiles: true,
    requireImportedConfirmation: false,
  };
}
