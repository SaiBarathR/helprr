'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import type { FailedImportConfig, QueueCleanerConfigShape, SlowRuleShape, StallRuleShape } from '@/lib/cleanup/types';

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
      <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
      <SelectContent>
        <SelectItem value="public">Public</SelectItem>
        <SelectItem value="private">Private</SelectItem>
        <SelectItem value="both">Public & Private</SelectItem>
      </SelectContent>
    </Select>
  );
}

export function QueueCleanerTab() {
  const [cfg, setCfg] = useState<QueueCleanerConfigShape | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [stallRules, setStallRules] = useState<StallRuleShape[]>([]);
  const [slowRules, setSlowRules] = useState<SlowRuleShape[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);

  const refresh = useCallback(async () => {
    setLoadingRules(true);
    try {
      const [cfgR, stallR, slowR] = await Promise.all([
        fetch('/api/cleanup/queue/config').then((r) => r.json()),
        fetch('/api/cleanup/queue/stall-rules').then((r) => r.json()),
        fetch('/api/cleanup/queue/slow-rules').then((r) => r.json()),
      ]);
      setCfg(cfgR);
      setStallRules(stallR);
      setSlowRules(slowR);
    } catch {
      toast.error('Failed to load queue cleaner settings');
    } finally {
      setLoadingRules(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveCfg = async () => {
    if (!cfg) return;
    setSavingCfg(true);
    try {
      const r = await fetch('/api/cleanup/queue/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!r.ok) throw new Error('save failed');
      const json = await r.json();
      setCfg(json);
      toast.success('Queue Cleaner settings saved');
    } catch (err) {
      toast.error((err as Error).message ?? 'Save failed');
    } finally {
      setSavingCfg(false);
    }
  };

  if (!cfg) {
    return <div className="py-12 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
      {/* General */}
      <section className="grouped-section">
        <div className="grouped-section-title">General</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <Label>Enabled</Label>
            <Switch checked={cfg.enabled} onCheckedChange={(v) => setCfg({ ...cfg, enabled: v })} />
          </div>
          <div className="grouped-row">
            <Label>Run every</Label>
            <div className="flex items-center gap-2">
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
          <div className="grouped-row">
            <div>
              <Label>Re-search after removal</Label>
              <p className="text-xs text-muted-foreground mt-0.5">When linked to Sonarr/Radarr, blocklist + trigger new search.</p>
            </div>
            <Switch checked={cfg.reSearchAfterRemoval} onCheckedChange={(v) => setCfg({ ...cfg, reSearchAfterRemoval: v })} />
          </div>
          <div className="grouped-row">
            <div>
              <Label>Process downloads without content ID</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Affects Failed Import only.</p>
            </div>
            <Switch checked={cfg.processNoContentId} onCheckedChange={(v) => setCfg({ ...cfg, processNoContentId: v })} />
          </div>
          <div className="grouped-row flex-col items-stretch gap-2">
            <Label>Ignored downloads (one per line)</Label>
            <textarea
              className="w-full text-sm rounded-md border bg-background px-3 py-2 font-mono min-h-[80px]"
              value={cfg.ignoredDownloads.join('\n')}
              onChange={(e) => setCfg({ ...cfg, ignoredDownloads: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              placeholder="hash, qBit category, qBit tag, or tracker domain"
            />
            <p className="text-xs text-muted-foreground">Matches torrent hash, qBittorrent category/tag, or tracker domain (suffix).</p>
          </div>
          <div className="grouped-row">
            <Label>Stuck on metadata — max strikes</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                className="w-24"
                value={cfg.downloadingMetadataMaxStrikes}
                onChange={(e) => setCfg({ ...cfg, downloadingMetadataMaxStrikes: Math.max(0, Number(e.target.value) || 0) })}
              />
              <span className="text-xs text-muted-foreground">0 = disabled · min 3</span>
            </div>
          </div>
        </div>
      </section>

      {/* Failed Import */}
      <section className="grouped-section">
        <div className="grouped-section-title">Failed Import</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <Label>Max strikes</Label>
            <div className="flex items-center gap-2">
              <Input
                type="number"
                min={0}
                className="w-24"
                value={cfg.failedImport.maxStrikes}
                onChange={(e) => setCfg({ ...cfg, failedImport: { ...cfg.failedImport, maxStrikes: Math.max(0, Number(e.target.value) || 0) } })}
              />
              <span className="text-xs text-muted-foreground">0 = disabled · min 3</span>
            </div>
          </div>
          <FailedImportFields cfg={cfg} setCfg={setCfg} />
        </div>
      </section>

      {/* Stall Rules */}
      <RuleList<StallRuleShape>
        title="Stall Rules"
        description="Strike rules for torrents in stalledDL state. Reset on progress (with optional minimum byte threshold)."
        rules={stallRules}
        loading={loadingRules}
        onChanged={refresh}
        kind="stall"
        defaults={() => makeDefaultStall()}
        renderRule={(rule, update) => (
          <StallRuleEditor rule={rule} onChange={update} />
        )}
      />

      {/* Slow Rules */}
      <RuleList<SlowRuleShape>
        title="Slow Rules"
        description="Strike rules for slow downloads (speed below threshold or running longer than max time)."
        rules={slowRules}
        loading={loadingRules}
        onChanged={refresh}
        kind="slow"
        defaults={() => makeDefaultSlow()}
        renderRule={(rule, update) => <SlowRuleEditor rule={rule} onChange={update} />}
      />

      <div className="flex justify-end gap-2 sticky bottom-4">
        <Button onClick={saveCfg} disabled={savingCfg} className="shadow-lg">
          {savingCfg ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save general & failed-import settings
        </Button>
      </div>
    </div>
  );
}

function FailedImportFields({ cfg, setCfg }: { cfg: QueueCleanerConfigShape; setCfg: (c: QueueCleanerConfigShape) => void }) {
  const fi = cfg.failedImport;
  const setFi = (next: Partial<FailedImportConfig>) => setCfg({ ...cfg, failedImport: { ...fi, ...next } });
  return (
    <>
      <div className="grouped-row">
        <Label>Pattern mode</Label>
        <Select value={fi.patternMode} onValueChange={(v) => setFi({ patternMode: v as 'include' | 'exclude' })}>
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="exclude">Exclude</SelectItem>
            <SelectItem value="include">Include</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <div className="grouped-row flex-col items-stretch gap-2">
        <Label>Patterns (one per line)</Label>
        <textarea
          className="w-full text-sm rounded-md border bg-background px-3 py-2 font-mono min-h-[80px]"
          value={fi.patterns.join('\n')}
          onChange={(e) => setFi({ patterns: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
          placeholder="e.g. title mismatch&#10;manual import required"
        />
        <p className="text-xs text-muted-foreground">Matches substrings in failed-import status messages.</p>
      </div>
      <div className="grouped-row">
        <Label>Ignore private torrents</Label>
        <Switch checked={fi.ignorePrivate} onCheckedChange={(v) => setFi({ ignorePrivate: v })} />
      </div>
      <div className="grouped-row">
        <Label>Skip if not found in client</Label>
        <Switch checked={fi.skipIfNotFoundInClient} onCheckedChange={(v) => setFi({ skipIfNotFoundInClient: v })} />
      </div>
      <div className="grouped-row">
        <div className="flex items-center gap-2">
          <Label>Change category (instead of delete)</Label>
        </div>
        <Switch
          checked={fi.changeCategory}
          onCheckedChange={(v) => setFi({ changeCategory: v, deletePrivate: v ? false : fi.deletePrivate })}
        />
      </div>
      <div className="grouped-row">
        <div className="flex items-center gap-2">
          <Label>Delete private torrents</Label>
          {fi.deletePrivate && <AlertTriangle className="w-4 h-4 text-amber-500" />}
        </div>
        <Switch
          checked={fi.deletePrivate}
          onCheckedChange={(v) => setFi({ deletePrivate: v, changeCategory: v ? false : fi.changeCategory })}
        />
      </div>
      {fi.deletePrivate && (
        <div className="grouped-row text-xs text-amber-600 dark:text-amber-500">
          Warning: deleting private torrents can affect your tracker H&R standing.
        </div>
      )}
    </>
  );
}

function RuleList<R extends { id: string; name: string; enabled: boolean; priority: number }>({
  title,
  description,
  rules,
  loading,
  onChanged,
  kind,
  defaults,
  renderRule,
}: {
  title: string;
  description: string;
  rules: R[];
  loading: boolean;
  onChanged: () => void;
  kind: 'stall' | 'slow';
  defaults: () => Omit<R, 'id'>;
  renderRule: (rule: R, update: (next: R) => void) => React.ReactNode;
}) {
  const [overrides, setOverrides] = useState<Record<string, R>>({});
  const editing = rules.reduce<Record<string, R>>((acc, rule) => {
    acc[rule.id] = overrides[rule.id] ?? rule;
    return acc;
  }, {});
  const setEditing = (updater: (m: Record<string, R>) => Record<string, R>) => {
    setOverrides((prev) => {
      const merged = rules.reduce<Record<string, R>>((acc, rule) => {
        acc[rule.id] = prev[rule.id] ?? rule;
        return acc;
      }, {});
      return updater(merged);
    });
  };

  const create = async () => {
    const r = await fetch(`/api/cleanup/queue/${kind}-rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(defaults()),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      toast.error(j?.error ?? 'Create failed');
      return;
    }
    toast.success('Rule created');
    onChanged();
  };

  const save = async (rule: R) => {
    const r = await fetch(`/api/cleanup/queue/${kind}-rules/${rule.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(rule),
    });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      toast.error(j?.error ?? 'Save failed');
      return;
    }
    toast.success('Rule saved');
    onChanged();
  };

  const remove = async (rule: R) => {
    if (!confirm(`Delete rule "${rule.name}"?`)) return;
    const r = await fetch(`/api/cleanup/queue/${kind}-rules/${rule.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      toast.error(j?.error ?? 'Delete failed');
      return;
    }
    toast.success('Rule deleted');
    onChanged();
  };

  return (
    <section className="grouped-section">
      <div className="grouped-section-title flex items-center justify-between">
        <span>{title}</span>
        <Button size="sm" variant="ghost" onClick={create}><Plus className="w-4 h-4 mr-1" /> Add rule</Button>
      </div>
      <div className="grouped-section-content">
        {loading ? (
          <div className="grouped-row text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
        ) : rules.length === 0 ? (
          <div className="grouped-row flex-col items-stretch gap-1 text-sm text-muted-foreground">
            <span>{description}</span>
            <span className="text-xs">No rules yet. Click &ldquo;Add rule&rdquo; to create one.</span>
          </div>
        ) : (
          rules.map((rule) => {
            const cur = editing[rule.id] ?? rule;
            return (
              <div key={rule.id} className="grouped-row flex-col items-stretch gap-3">
                <div className="flex items-center justify-between gap-2">
                  <Input
                    value={cur.name}
                    onChange={(e) => setEditing((m) => ({ ...m, [rule.id]: { ...cur, name: e.target.value } as R }))}
                    placeholder="Rule name"
                    className="font-medium max-w-xs"
                  />
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={cur.enabled}
                      onCheckedChange={(v) => setEditing((m) => ({ ...m, [rule.id]: { ...cur, enabled: v } as R }))}
                    />
                    <Button size="sm" variant="ghost" onClick={() => save(cur)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                    <Button size="sm" variant="ghost" onClick={() => remove(rule)}><Trash2 className="w-4 h-4" /></Button>
                  </div>
                </div>
                {renderRule(cur, (next) => setEditing((m) => ({ ...m, [rule.id]: next })))}
              </div>
            );
          })
        )}
      </div>
    </section>
  );
}

function StallRuleEditor({ rule, onChange }: { rule: StallRuleShape; onChange: (next: StallRuleShape) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <Field label="Max strikes">
        <Input type="number" min={3} value={rule.maxStrikes}
          onChange={(e) => onChange({ ...rule, maxStrikes: Math.max(3, Number(e.target.value) || 3) })} />
      </Field>
      <Field label="Privacy">
        <PrivacySelect value={rule.privacyType} onChange={(v) => onChange({ ...rule, privacyType: v })} />
      </Field>
      <Field label="Completion % range">
        <PercentRange min={rule.minCompletionPercentage} max={rule.maxCompletionPercentage}
          onChange={(min, max) => onChange({ ...rule, minCompletionPercentage: min, maxCompletionPercentage: max })} />
      </Field>
      <Field label="Priority">
        <Input type="number" value={rule.priority}
          onChange={(e) => onChange({ ...rule, priority: Number(e.target.value) || 0 })} />
      </Field>
      <Field label="Reset strikes on progress">
        <Switch checked={rule.resetStrikesOnProgress} onCheckedChange={(v) => onChange({ ...rule, resetStrikesOnProgress: v })} />
      </Field>
      <Field label="Minimum progress (bytes) to reset">
        <Input type="number" min={0} value={rule.minimumProgressBytes ?? ''}
          placeholder="(any progress)"
          onChange={(e) => onChange({ ...rule, minimumProgressBytes: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} />
      </Field>
      <Field label="Change category on removal">
        <Switch checked={rule.changeCategory}
          onCheckedChange={(v) => onChange({ ...rule, changeCategory: v, deletePrivate: v ? false : rule.deletePrivate })} />
      </Field>
      <Field label="Delete private from client">
        <Switch checked={rule.deletePrivate}
          onCheckedChange={(v) => onChange({ ...rule, deletePrivate: v, changeCategory: v ? false : rule.changeCategory })} />
      </Field>
      <Field label="Re-search override">
        <Select
          value={rule.reSearchOverride === null ? 'inherit' : rule.reSearchOverride ? 'true' : 'false'}
          onValueChange={(v) => onChange({ ...rule, reSearchOverride: v === 'inherit' ? null : v === 'true' })}
        >
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit global</SelectItem>
            <SelectItem value="true">Always re-search</SelectItem>
            <SelectItem value="false">Never re-search</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function SlowRuleEditor({ rule, onChange }: { rule: SlowRuleShape; onChange: (next: SlowRuleShape) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <Field label="Max strikes">
        <Input type="number" min={3} value={rule.maxStrikes}
          onChange={(e) => onChange({ ...rule, maxStrikes: Math.max(3, Number(e.target.value) || 3) })} />
      </Field>
      <Field label="Privacy">
        <PrivacySelect value={rule.privacyType} onChange={(v) => onChange({ ...rule, privacyType: v })} />
      </Field>
      <Field label="Min speed (KB/s)">
        <Input type="number" min={0} value={rule.minSpeedKbps ?? ''}
          placeholder="(disabled)"
          onChange={(e) => onChange({ ...rule, minSpeedKbps: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} />
      </Field>
      <Field label="Max time (hours)">
        <Input type="number" min={0} step={0.5} value={rule.maxTimeHours ?? ''}
          placeholder="(disabled)"
          onChange={(e) => onChange({ ...rule, maxTimeHours: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} />
      </Field>
      <Field label="Completion % range">
        <PercentRange min={rule.minCompletionPercentage} max={rule.maxCompletionPercentage}
          onChange={(min, max) => onChange({ ...rule, minCompletionPercentage: min, maxCompletionPercentage: max })} />
      </Field>
      <Field label="Ignore above size (bytes)">
        <Input type="number" min={0} value={rule.ignoreAboveSizeBytes ?? ''}
          placeholder="(no limit)"
          onChange={(e) => onChange({ ...rule, ignoreAboveSizeBytes: e.target.value === '' ? null : Math.max(0, Number(e.target.value) || 0) })} />
      </Field>
      <Field label="Priority">
        <Input type="number" value={rule.priority}
          onChange={(e) => onChange({ ...rule, priority: Number(e.target.value) || 0 })} />
      </Field>
      <Field label="Reset strikes on progress">
        <Switch checked={rule.resetStrikesOnProgress} onCheckedChange={(v) => onChange({ ...rule, resetStrikesOnProgress: v })} />
      </Field>
      <Field label="Change category on removal">
        <Switch checked={rule.changeCategory}
          onCheckedChange={(v) => onChange({ ...rule, changeCategory: v, deletePrivate: v ? false : rule.deletePrivate })} />
      </Field>
      <Field label="Delete private from client">
        <Switch checked={rule.deletePrivate}
          onCheckedChange={(v) => onChange({ ...rule, deletePrivate: v, changeCategory: v ? false : rule.changeCategory })} />
      </Field>
      <Field label="Re-search override">
        <Select
          value={rule.reSearchOverride === null ? 'inherit' : rule.reSearchOverride ? 'true' : 'false'}
          onValueChange={(v) => onChange({ ...rule, reSearchOverride: v === 'inherit' ? null : v === 'true' })}
        >
          <SelectTrigger className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="inherit">Inherit global</SelectItem>
            <SelectItem value="true">Always re-search</SelectItem>
            <SelectItem value="false">Never re-search</SelectItem>
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
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

