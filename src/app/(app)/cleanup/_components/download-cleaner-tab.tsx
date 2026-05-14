'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Loader2, Plus, Save, Trash2, AlertTriangle } from 'lucide-react';
import type { DownloadCleanerConfigShape, SeedingRuleShape } from '@/lib/cleanup/types';

export function DownloadCleanerTab() {
  const [cfg, setCfg] = useState<DownloadCleanerConfigShape | null>(null);
  const [savingCfg, setSavingCfg] = useState(false);
  const [rules, setRules] = useState<SeedingRuleShape[]>([]);
  const [loadingRules, setLoadingRules] = useState(true);
  const [overrides, setOverrides] = useState<Record<string, SeedingRuleShape>>({});
  const editing = rules.reduce<Record<string, SeedingRuleShape>>((acc, rule) => {
    acc[rule.id] = overrides[rule.id] ?? rule;
    return acc;
  }, {});
  const setEditing = (updater: (m: Record<string, SeedingRuleShape>) => Record<string, SeedingRuleShape>) => {
    setOverrides((prev) => {
      const merged = rules.reduce<Record<string, SeedingRuleShape>>((acc, rule) => {
        acc[rule.id] = prev[rule.id] ?? rule;
        return acc;
      }, {});
      return updater(merged);
    });
  };

  const refresh = useCallback(async () => {
    setLoadingRules(true);
    try {
      const [cfgR, rulesR] = await Promise.all([
        fetch('/api/cleanup/download/config').then((r) => r.json()),
        fetch('/api/cleanup/download/seeding-rules').then((r) => r.json()),
      ]);
      setCfg(cfgR);
      setRules(rulesR);
      setOverrides({});
    } catch {
      toast.error('Failed to load download cleaner settings');
    } finally {
      setLoadingRules(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const saveCfg = async () => {
    if (!cfg) return;
    setSavingCfg(true);
    try {
      const r = await fetch('/api/cleanup/download/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(cfg),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => null);
        throw new Error(j?.error ?? 'save failed');
      }
      toast.success('Download Cleaner settings saved');
      refresh();
    } catch (err) {
      toast.error((err as Error).message ?? 'Save failed');
    } finally {
      setSavingCfg(false);
    }
  };

  const createRule = async () => {
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
    toast.success('Seeding rule created');
    refresh();
  };

  const saveRule = async (rule: SeedingRuleShape) => {
    const r = await fetch(`/api/cleanup/download/seeding-rules/${rule.id}`, {
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
    refresh();
  };

  const deleteRule = async (rule: SeedingRuleShape) => {
    if (!confirm(`Delete "${rule.name}"?`)) return;
    const r = await fetch(`/api/cleanup/download/seeding-rules/${rule.id}`, { method: 'DELETE' });
    if (!r.ok) {
      const j = await r.json().catch(() => null);
      toast.error(j?.error ?? 'Delete failed');
      return;
    }
    toast.success('Rule deleted');
    refresh();
  };

  if (!cfg) {
    return <div className="py-12 flex items-center justify-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading…</div>;
  }

  return (
    <div className="space-y-6">
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
          <div className="grouped-row flex-col items-stretch gap-2">
            <Label>Ignored downloads (one per line)</Label>
            <textarea
              className="w-full text-sm rounded-md border bg-background px-3 py-2 font-mono min-h-[80px]"
              value={cfg.ignoredDownloads.join('\n')}
              onChange={(e) => setCfg({ ...cfg, ignoredDownloads: e.target.value.split('\n').map((s) => s.trim()).filter(Boolean) })}
              placeholder="hash, qBit category, qBit tag, or tracker domain"
            />
          </div>
        </div>
      </section>

      <section className="grouped-section">
        <div className="grouped-section-title">Auto-remove imported downloads</div>
        <div className="grouped-section-content">
          <div className="grouped-row">
            <div>
              <Label>Enabled</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Removes torrents in the listed categories as soon as the arr imports them.</p>
            </div>
            <Switch checked={cfg.autoRemoveImportedEnabled}
              onCheckedChange={(v) => setCfg({ ...cfg, autoRemoveImportedEnabled: v })} />
          </div>
          <div className="grouped-row flex-col items-stretch gap-2">
            <Label>Categories (comma-separated)</Label>
            <Input
              value={cfg.autoRemoveImportedCategories.join(', ')}
              onChange={(e) => setCfg({ ...cfg, autoRemoveImportedCategories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
              placeholder="sonarr, radarr"
            />
            <p className="text-xs text-muted-foreground">Default qBittorrent categories used by Sonarr/Radarr.</p>
          </div>
          <div className="grouped-row">
            <Label>Delete files</Label>
            <Switch checked={cfg.autoRemoveImportedDeleteFiles}
              onCheckedChange={(v) => setCfg({ ...cfg, autoRemoveImportedDeleteFiles: v })} />
          </div>
        </div>
      </section>

      <div className="flex justify-end">
        <Button onClick={saveCfg} disabled={savingCfg}>
          {savingCfg ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Save className="w-4 h-4 mr-2" />}
          Save general settings
        </Button>
      </div>

      <section className="grouped-section">
        <div className="grouped-section-title flex items-center justify-between">
          <span>Seeding rules</span>
          <Button size="sm" variant="ghost" onClick={createRule}><Plus className="w-4 h-4 mr-1" /> Add rule</Button>
        </div>
        <div className="grouped-section-content">
          {loadingRules ? (
            <div className="grouped-row text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading…</div>
          ) : rules.length === 0 ? (
            <div className="grouped-row text-sm text-muted-foreground">
              No seeding rules yet. Removal happens when (ratio ≥ maxRatio AND seedTime ≥ minSeedTime) OR seedTime ≥ maxSeedTime.
            </div>
          ) : (
            rules.map((rule) => {
              const cur = editing[rule.id] ?? rule;
              const isSystem = rule.isSystem;
              return (
                <div key={rule.id} className="grouped-row flex-col items-stretch gap-3">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0 flex-1">
                      <Input
                        disabled={isSystem}
                        value={cur.name}
                        onChange={(e) => setEditing((m) => ({ ...m, [rule.id]: { ...cur, name: e.target.value } }))}
                        placeholder="Rule name"
                        className="font-medium max-w-xs"
                      />
                      {isSystem && <span className="text-xs text-muted-foreground">(managed by toggle above)</span>}
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        disabled={isSystem}
                        checked={cur.enabled}
                        onCheckedChange={(v) => setEditing((m) => ({ ...m, [rule.id]: { ...cur, enabled: v } }))}
                      />
                      {!isSystem && (
                        <>
                          <Button size="sm" variant="ghost" onClick={() => saveRule(cur)}><Save className="w-4 h-4 mr-1" /> Save</Button>
                          <Button size="sm" variant="ghost" onClick={() => deleteRule(rule)}><Trash2 className="w-4 h-4" /></Button>
                        </>
                      )}
                    </div>
                  </div>
                  <SeedingRuleEditor rule={cur} disabled={isSystem} onChange={(next) => setEditing((m) => ({ ...m, [rule.id]: next }))} />
                </div>
              );
            })
          )}
        </div>
      </section>

      <div className="text-xs text-muted-foreground flex items-start gap-2 px-1">
        <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        <span>Seeding rules apply only to torrents that are 100% downloaded and in a seeding/paused-up state. They do not re-search; the arrs have already imported these.</span>
      </div>
    </div>
  );
}

function SeedingRuleEditor({ rule, disabled, onChange }: { rule: SeedingRuleShape; disabled: boolean; onChange: (next: SeedingRuleShape) => void }) {
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
      <Field label="Categories (comma-separated)">
        <Input disabled={disabled}
          value={rule.categories.join(', ')}
          onChange={(e) => onChange({ ...rule, categories: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="Tracker patterns (comma-separated)">
        <Input disabled={disabled}
          value={rule.trackerPatterns.join(', ')}
          placeholder="domain suffixes"
          onChange={(e) => onChange({ ...rule, trackerPatterns: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="Tags — match any (comma-separated)">
        <Input disabled={disabled}
          value={rule.tagsAny.join(', ')}
          onChange={(e) => onChange({ ...rule, tagsAny: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="Tags — match all (comma-separated)">
        <Input disabled={disabled}
          value={rule.tagsAll.join(', ')}
          onChange={(e) => onChange({ ...rule, tagsAll: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })}
        />
      </Field>
      <Field label="Privacy">
        <Select value={rule.privacyType} onValueChange={(v) => onChange({ ...rule, privacyType: v as 'public' | 'private' | 'both' })}>
          <SelectTrigger disabled={disabled} className="w-40"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="public">Public</SelectItem>
            <SelectItem value="private">Private</SelectItem>
            <SelectItem value="both">Public & Private</SelectItem>
          </SelectContent>
        </Select>
      </Field>
      <Field label="Priority">
        <Input disabled={disabled} type="number" value={rule.priority}
          onChange={(e) => onChange({ ...rule, priority: Number(e.target.value) || 0 })} />
      </Field>
      <Field label="Max ratio (-1 disables)">
        <Input disabled={disabled} type="number" step={0.1} value={rule.maxRatio}
          onChange={(e) => onChange({ ...rule, maxRatio: Number(e.target.value) })} />
      </Field>
      <Field label="Min seed time (hours)">
        <Input disabled={disabled} type="number" min={0} step={0.5} value={rule.minSeedTimeHours}
          onChange={(e) => onChange({ ...rule, minSeedTimeHours: Math.max(0, Number(e.target.value) || 0) })} />
      </Field>
      <Field label="Max seed time (hours, -1 disables)">
        <Input disabled={disabled} type="number" step={0.5} value={rule.maxSeedTimeHours}
          onChange={(e) => onChange({ ...rule, maxSeedTimeHours: Number(e.target.value) })} />
      </Field>
      <Field label="Delete source files">
        <Switch disabled={disabled} checked={rule.deleteSourceFiles}
          onCheckedChange={(v) => onChange({ ...rule, deleteSourceFiles: v })} />
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
    maxRatio: 1.0,
    minSeedTimeHours: 0,
    maxSeedTimeHours: -1,
    deleteSourceFiles: true,
  };
}
