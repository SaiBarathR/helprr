'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
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
  const startMin = rule.startHour * 60 + rule.startMinute;
  const endMin = rule.endHour * 60 + rule.endMinute;
  const start = `${String(rule.startHour).padStart(2, '0')}:${String(rule.startMinute).padStart(2, '0')}`;
  const end = `${String(rule.endHour).padStart(2, '0')}:${String(rule.endMinute).padStart(2, '0')}`;
  if (endMin === startMin) return 'All day';
  return endMin < startMin ? `${start} → ${end} (next day)` : `${start} → ${end}`;
}

export default function DownloadsSettingsPage() {
  const [rules, setRules] = useState<BandwidthRule[]>([]);
  const [timeZone, setTimeZone] = useState<string>('UTC');
  const [activeRuleId, setActiveRuleId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);

  const scheduleQuery = useQuery({
    queryKey: ['qbittorrent', 'bandwidth-schedule'],
    queryFn: jsonFetcher<ScheduleResponse>('/api/qbittorrent/bandwidth-schedule'),
  });
  const loading = scheduleQuery.isLoading;

  // Seed the editable state once from the loaded schedule (don't re-seed on
  // background refetches — that would clobber in-progress edits). The save
  // mutation updates this state directly from its response. Guarded one-shot
  // during render (React's "adjusting state when props change" pattern).
  const [seeded, setSeeded] = useState(false);
  if (!seeded && scheduleQuery.data) {
    setSeeded(true);
    setRules(scheduleQuery.data.schedule.rules);
    setTimeZone(scheduleQuery.data.timeZone);
    setActiveRuleId(scheduleQuery.data.activeRuleId);
  }

  const saveMutation = useMutation({
    mutationFn: async (rulesToSave: BandwidthRule[]) => {
      const res = await fetch('/api/qbittorrent/bandwidth-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ rules: rulesToSave }),
      });
      const payload = (await res.json().catch(() => null)) as ScheduleResponse | { error?: string } | null;
      if (!res.ok || !payload || !('schedule' in payload)) {
        const message = (payload && 'error' in payload && payload.error) || 'Failed to save schedule';
        // ApiError so a 401 carries its status to the global MutationCache handler.
        throw new ApiError(res.status, message);
      }
      return payload;
    },
    onSuccess: (payload) => {
      setRules(payload.schedule.rules);
      setTimeZone(payload.timeZone);
      setActiveRuleId(payload.activeRuleId);
      setDirty(false);
      toast.success('Schedule saved');
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error(err instanceof Error ? err.message : 'Failed to save schedule');
    },
  });
  const saving = saveMutation.isPending;

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
          onClick={() => saveMutation.mutate(rules)}
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
    <div className="mx-4 rounded-lg border border-foreground/[0.07] bg-foreground/[0.02] px-4 py-4 space-y-4">
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
                aria-label={DAY_NAMES[dow]}
                className={`h-9 w-9 rounded-md text-xs font-mono transition-colors border ${
                  active
                    ? 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                    : 'bg-transparent text-muted-foreground border-foreground/[0.08] hover:border-foreground/[0.16]'
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
            showSeconds={false}
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
            showSeconds={false}
            onChange={(v) => {
              const { hour, minute } = parseTime(v);
              onChange({ endHour: hour, endMinute: minute });
            }}
          />
        </div>
      </div>

      {rule.endHour * 60 + rule.endMinute === rule.startHour * 60 + rule.startMinute ? (
        <p className="text-[11px] text-muted-foreground/80">
          Start and End are equal — rule is active all day on the selected days.
        </p>
      ) : rule.endHour * 60 + rule.endMinute < rule.startHour * 60 + rule.startMinute ? (
        <p className="text-[11px] text-muted-foreground/80">
          End is before Start — rule wraps past midnight.
        </p>
      ) : null}

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
