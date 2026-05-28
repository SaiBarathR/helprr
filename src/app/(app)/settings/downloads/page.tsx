'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ChevronLeft, Plus, Trash2, Save, Loader2, Zap } from 'lucide-react';
import { toast } from 'sonner';
import { GroupedSection } from '@/components/settings/grouped-section';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { TimePicker } from '@/components/ui/time-picker';
import { Badge } from '@/components/ui/badge';
import type { BandwidthRule } from '@/lib/bandwidth-scheduler/types';
import { MAX_KBPS } from '@/lib/bandwidth-scheduler/types';

interface ScheduleResponse {
  schedule: { rules: BandwidthRule[] };
  timeZone: string;
  activeRuleId: string | null;
}

const DAY_LABELS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function newRule(): BandwidthRule {
  return {
    id: crypto.randomUUID(),
    name: 'Off-peak throttle',
    enabled: true,
    daysOfWeek: [1, 2, 3, 4, 5],
    startHour: 8,
    startMinute: 0,
    endHour: 23,
    endMinute: 0,
    downloadLimitKbps: 5000,
    uploadLimitKbps: 1000,
  };
}

function fmtTime(h: number, m: number): string {
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:00`;
}

function parseTime(value: string): { hour: number; minute: number } {
  const [h, m] = value.split(':');
  return {
    hour: Math.min(23, Math.max(0, Number(h) || 0)),
    minute: Math.min(59, Math.max(0, Number(m) || 0)),
  };
}

function clampKbps(value: string | number): number {
  const n = typeof value === 'string' ? parseInt(value, 10) : value;
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(MAX_KBPS, Math.floor(n));
}

function formatKbps(kbps: number): string {
  if (kbps === 0) return 'Unlimited';
  if (kbps >= 1000) return `${(kbps / 1000).toFixed(kbps % 1000 === 0 ? 0 : 1)} MB/s`;
  return `${kbps} KB/s`;
}

function formatWindow(rule: BandwidthRule): string {
  const wrap = rule.endHour * 60 + rule.endMinute <= rule.startHour * 60 + rule.startMinute;
  const start = `${String(rule.startHour).padStart(2, '0')}:${String(rule.startMinute).padStart(2, '0')}`;
  const end = `${String(rule.endHour).padStart(2, '0')}:${String(rule.endMinute).padStart(2, '0')}`;
  return wrap ? `${start} → ${end} (next day)` : `${start} → ${end}`;
}

export default function DownloadsSettingsPage() {
  const [rules, setRules] = useState<BandwidthRule[]>([]);
  const [timeZone, setTimeZone] = useState<string>('UTC');
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/qbittorrent/bandwidth-schedule');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as ScheduleResponse;
      setRules(data.schedule.rules);
      setTimeZone(data.timeZone);
      setActiveRuleId(data.activeRuleId);
      setDirty(false);
    } catch (err) {
      console.error('Failed to load bandwidth schedule', err);
      toast.error('Failed to load bandwidth schedule');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const activeRule = useMemo(
    () => rules.find((r) => r.id === activeRuleId) ?? null,
    [rules, activeRuleId],
  );

  function patchRule(id: string, patch: Partial<BandwidthRule>) {
    setRules((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
    setDirty(true);
  }

  function addRule() {
    setRules((prev) => [...prev, newRule()]);
    setDirty(true);
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r.id !== id));
    setDirty(true);
  }

  async function save() {
    setSaving(true);
    try {
      const res = await fetch('/api/qbittorrent/bandwidth-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules }),
      });
      const payload = (await res.json().catch(() => null)) as ScheduleResponse | { error?: string } | null;
      if (!res.ok || !payload || !('schedule' in payload)) {
        const message = (payload && 'error' in payload && payload.error) || 'Failed to save schedule';
        toast.error(message);
        return;
      }
      setRules(payload.schedule.rules);
      setActiveRuleId(payload.activeRuleId);
      setDirty(false);
      toast.success('Schedule saved');
    } catch (err) {
      console.error('Failed to save bandwidth schedule', err);
      toast.error('Failed to save schedule');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="animate-content-in pb-12">
      <div className="px-1 pt-1 pb-2">
        <Link
          href="/settings"
          className="inline-flex items-center gap-1 text-sm text-primary -ml-1 min-h-[44px] px-1"
        >
          <ChevronLeft className="h-5 w-5" />
          Settings
        </Link>
      </div>

      <div className="px-4 mb-4">
        <h1 className="text-2xl font-semibold">Downloads</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Time-of-day bandwidth rules applied to qBittorrent. Times are in your configured
          timezone <span className="font-mono">({timeZone})</span>. Rules are evaluated top-to-bottom — the
          first matching rule wins.
        </p>
      </div>

      {activeRule && (
        <div className="mx-4 mb-6 rounded-lg border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 projector-glow">
          <div className="flex items-center gap-2 tracked-caps text-[10px] text-amber-400">
            <Zap className="h-3 w-3" />
            Active now
          </div>
          <div className="mt-1 text-sm font-medium">{activeRule.name}</div>
          <div className="mt-0.5 text-xs text-muted-foreground font-mono">
            ↓ {formatKbps(activeRule.downloadLimitKbps)} · ↑ {formatKbps(activeRule.uploadLimitKbps)} · {formatWindow(activeRule)}
          </div>
        </div>
      )}

      {loading && (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            <Loader2 className="h-5 w-5 mx-auto mb-2 animate-spin opacity-60" />
            Loading schedule…
          </div>
        </GroupedSection>
      )}

      {!loading && rules.length === 0 && (
        <GroupedSection>
          <div className="px-4 py-6 text-center text-sm text-muted-foreground">
            No rules yet. Add one to throttle qBittorrent during certain hours
            (or set a 0 KB/s limit to keep things unlimited at all other times).
          </div>
        </GroupedSection>
      )}

      <div className="space-y-4">
        {rules.map((rule) => (
          <RuleCard
            key={rule.id}
            rule={rule}
            isActive={rule.id === activeRuleId}
            onChange={(patch) => patchRule(rule.id, patch)}
            onRemove={() => removeRule(rule.id)}
          />
        ))}
      </div>

      <div className="px-4 mt-6 flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={addRule}
          disabled={loading}
          className="h-9"
        >
          <Plus className="mr-2 h-4 w-4" />
          Add rule
        </Button>
        <Button
          type="button"
          onClick={() => void save()}
          disabled={!dirty || saving || loading}
          className="h-9"
        >
          {saving ? (
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          ) : (
            <Save className="mr-2 h-4 w-4" />
          )}
          Save schedule
        </Button>
      </div>
    </div>
  );
}

interface RuleCardProps {
  rule: BandwidthRule;
  isActive: boolean;
  onChange: (patch: Partial<BandwidthRule>) => void;
  onRemove: () => void;
}

function RuleCard({ rule, isActive, onChange, onRemove }: RuleCardProps) {
  function toggleDay(day: number) {
    const set = new Set(rule.daysOfWeek);
    if (set.has(day)) set.delete(day);
    else set.add(day);
    onChange({ daysOfWeek: Array.from(set).sort((a, b) => a - b) });
  }

  const startStr = fmtTime(rule.startHour, rule.startMinute);
  const endStr = fmtTime(rule.endHour, rule.endMinute);

  return (
    <div className="mx-4 rounded-lg border border-[oklch(1_0_0/7%)] bg-[oklch(1_0_0/2%)] px-4 py-4 space-y-4">
      <div className="flex items-center gap-3">
        <Input
          value={rule.name}
          onChange={(e) => onChange({ name: e.target.value })}
          placeholder="Rule name"
          maxLength={80}
          className="h-9 flex-1"
        />
        {isActive && (
          <Badge
            variant="outline"
            className="border-amber-500/40 text-amber-400 bg-amber-500/10 tracked-mid text-[10px]"
          >
            Active
          </Badge>
        )}
        <Switch
          checked={rule.enabled}
          onCheckedChange={(v) => onChange({ enabled: v })}
          aria-label="Enable rule"
        />
      </div>

      <div>
        <Label className="tracked-caps text-[10px] text-muted-foreground mb-2 block">
          Days
        </Label>
        <div className="flex gap-1.5">
          {DAY_LABELS.map((label, dow) => {
            const active = rule.daysOfWeek.includes(dow);
            return (
              <button
                key={dow}
                type="button"
                onClick={() => toggleDay(dow)}
                title={DAY_NAMES[dow]}
                className={`h-9 w-9 rounded-md text-xs font-mono transition-colors border ${
                  active
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-transparent text-muted-foreground border-[oklch(1_0_0/8%)] hover:border-[oklch(1_0_0/16%)]'
                }`}
                aria-pressed={active}
              >
                {label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="tracked-caps text-[10px] text-muted-foreground">
            Start
          </Label>
          <TimePicker
            value={startStr}
            onChange={(v) => {
              const { hour, minute } = parseTime(v);
              onChange({ startHour: hour, startMinute: minute });
            }}
          />
        </div>
        <div className="space-y-1.5">
          <Label className="tracked-caps text-[10px] text-muted-foreground">
            End
          </Label>
          <TimePicker
            value={endStr}
            onChange={(v) => {
              const { hour, minute } = parseTime(v);
              onChange({ endHour: hour, endMinute: minute });
            }}
          />
        </div>
      </div>

      {rule.endHour * 60 + rule.endMinute <= rule.startHour * 60 + rule.startMinute && (
        <p className="text-[11px] text-muted-foreground/80">
          End is at or before Start — rule wraps past midnight.
        </p>
      )}

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label className="tracked-caps text-[10px] text-muted-foreground">
            Download limit (KB/s)
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_KBPS}
            value={rule.downloadLimitKbps}
            onChange={(e) => onChange({ downloadLimitKbps: clampKbps(e.target.value) })}
            className="h-9 font-mono"
          />
          <div className="text-[11px] text-muted-foreground/80">
            {formatKbps(rule.downloadLimitKbps)} · 0 = unlimited
          </div>
        </div>
        <div className="space-y-1.5">
          <Label className="tracked-caps text-[10px] text-muted-foreground">
            Upload limit (KB/s)
          </Label>
          <Input
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_KBPS}
            value={rule.uploadLimitKbps}
            onChange={(e) => onChange({ uploadLimitKbps: clampKbps(e.target.value) })}
            className="h-9 font-mono"
          />
          <div className="text-[11px] text-muted-foreground/80">
            {formatKbps(rule.uploadLimitKbps)} · 0 = unlimited
          </div>
        </div>
      </div>

      <div className="flex justify-end">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRemove}
          className="text-destructive hover:text-destructive h-8"
        >
          <Trash2 className="mr-2 h-3.5 w-3.5" />
          Remove rule
        </Button>
      </div>
    </div>
  );
}
