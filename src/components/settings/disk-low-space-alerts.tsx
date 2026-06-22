'use client';

import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { Loader2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { GroupedSection } from '@/components/settings/grouped-section';
import { formatBytes } from '@/lib/format';

const GB = 1024 ** 3;

// One editable low-space-alert row. `present` is false for a saved threshold
// whose disk isn't currently reachable — shown so it can be reviewed/removed.
interface DiskRow {
  diskId: string;
  label: string;
  path: string;
  freeSpace: number | null;
  totalSpace: number | null;
  minFreeGb: string;
  enabled: boolean;
  present: boolean;
}

interface ApiThreshold {
  diskId: string;
  label: string;
  path: string;
  minFreeGb: number;
  enabled: boolean;
}
interface ApiDisk {
  diskId: string;
  label: string;
  path: string;
  freeSpace: number;
  totalSpace: number;
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

// Disk capacity bar: the filled portion is what's used right now; the dashed
// marker is the alert line — once usage crosses it (free drops below the
// threshold) the alert fires. The shaded band to the right of the marker is the
// free space the user wants to keep in reserve. Marker moves live as the
// threshold is edited.
function UsageBar({
  usedPct,
  markerPct,
  alerting,
}: {
  usedPct: number;
  markerPct: number;
  alerting: boolean;
}) {
  const fillClass = alerting
    ? 'bg-rose-500'
    : usedPct > 90
      ? 'bg-rose-500'
      : usedPct > 75
        ? 'bg-amber-500'
        : 'bg-emerald-500';
  return (
    <div className="relative h-3 select-none" aria-hidden>
      {/* track + used fill */}
      <div className="absolute inset-0 rounded-full bg-muted overflow-hidden">
        <div
          className={`h-full rounded-full transition-[width] duration-300 ${fillClass}`}
          style={{ width: `${usedPct}%` }}
        />
        {/* reserve band: the free space that should remain, right of the marker */}
        <div
          className="absolute inset-y-0 right-0 bg-foreground/[0.07]"
          style={{ left: `${markerPct}%` }}
        />
      </div>
      {/* alert-line marker */}
      <div
        className={`absolute -top-1 -bottom-1 w-px border-l border-dashed transition-[left] duration-200 ${
          alerting ? 'border-rose-400' : 'border-foreground/70'
        }`}
        style={{ left: `${markerPct}%` }}
      >
        <span
          className={`absolute -top-1 left-1/2 h-1.5 w-1.5 -translate-x-1/2 rounded-full ${
            alerting ? 'bg-rose-400' : 'bg-foreground/70'
          }`}
        />
      </div>
    </div>
  );
}

export function DiskLowSpaceAlerts() {
  const [rows, setRows] = useState<DiskRow[] | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/settings/disk-thresholds');
      if (!res.ok) {
        setRows([]);
        toast.error('Failed to load low-space alerts');
        return;
      }
      const data = (await res.json()) as { thresholds?: ApiThreshold[]; disks?: ApiDisk[] };
      const thresholds = Array.isArray(data.thresholds) ? data.thresholds : [];
      const disks = Array.isArray(data.disks) ? data.disks : [];
      const tById = new Map(thresholds.map((t) => [t.diskId, t]));
      const next: DiskRow[] = disks.map((d) => {
        const t = tById.get(d.diskId);
        return {
          diskId: d.diskId,
          label: d.label,
          path: d.path,
          freeSpace: d.freeSpace,
          totalSpace: d.totalSpace,
          minFreeGb: t ? String(t.minFreeGb) : '',
          enabled: t?.enabled ?? false,
          present: true,
        };
      });
      // Saved thresholds for disks not currently reachable — keep them visible.
      const presentIds = new Set(disks.map((d) => d.diskId));
      for (const t of thresholds) {
        if (presentIds.has(t.diskId)) continue;
        next.push({
          diskId: t.diskId,
          label: t.label,
          path: t.path,
          freeSpace: null,
          totalSpace: null,
          minFreeGb: String(t.minFreeGb),
          enabled: t.enabled,
          present: false,
        });
      }
      setRows(next);
    } catch {
      setRows([]);
      toast.error('Failed to load low-space alerts');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function updateRow(diskId: string, patch: Partial<DiskRow>) {
    setRows((prev) => (prev ?? []).map((r) => (r.diskId === diskId ? { ...r, ...patch } : r)));
  }

  async function save() {
    if (!rows) return;
    // Persist any row that's enabled or carries a positive threshold; drop the
    // untouched defaults so we don't store an empty row per disk.
    const thresholds = rows
      .filter((r) => r.enabled || (r.minFreeGb.trim() !== '' && Number(r.minFreeGb) > 0))
      .map((r) => ({
        diskId: r.diskId,
        label: r.label,
        path: r.path,
        minFreeGb: Number(r.minFreeGb) || 0,
        enabled: r.enabled,
      }));
    const invalid = thresholds.find((t) => t.enabled && !(t.minFreeGb > 0));
    if (invalid) {
      toast.error('Enabled disks need a free-space threshold above 0 GB');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/settings/disk-thresholds', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thresholds }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(payload?.error || 'Failed to save low-space alerts');
        return;
      }
      toast.success('Low-space alerts saved');
      await load();
    } catch {
      toast.error('Failed to save low-space alerts');
    } finally {
      setSaving(false);
    }
  }

  return (
    <GroupedSection
      title="Low-space alerts"
      footer="Push a notification when a disk drops below its free-space threshold · Re-reminds every 6 hours while low · Needs the Low Disk Space event enabled on a device"
    >
      {rows === null ? (
        <div className="grouped-row">
          <span className="text-sm text-muted-foreground">Loading…</span>
        </div>
      ) : rows.length === 0 ? (
        <div className="grouped-row">
          <span className="text-sm text-muted-foreground">No disks detected</span>
        </div>
      ) : (
        <>
          {rows.map((row) => {
            const total = row.totalSpace ?? 0;
            const free = row.freeSpace ?? 0;
            const usedPct = total > 0 ? clampPct(((total - free) / total) * 100) : 0;
            const minFreeBytes = (Number(row.minFreeGb) || 0) * GB;
            const markerPct = total > 0 ? clampPct(((total - minFreeBytes) / total) * 100) : 100;
            const alerting = row.enabled && total > 0 && minFreeBytes > 0 && free < minFreeBytes;
            // The mount path is the human-recognizable name; the *arr `label`
            // is a device UUID — show the path first, UUID as a muted subtitle.
            const primary = row.path || row.label;
            const secondary = row.label && row.label !== row.path ? row.label : null;
            return (
              <div key={row.diskId} className="px-4 py-3.5 border-b border-border/40 last:border-0">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{primary}</div>
                    {secondary && (
                      <div className="text-[11px] text-muted-foreground/70 truncate font-mono">{secondary}</div>
                    )}
                  </div>
                  <Switch
                    checked={row.enabled}
                    onCheckedChange={(next) => updateRow(row.diskId, { enabled: next })}
                    aria-label={`Enable low-space alert for ${primary}`}
                  />
                </div>

                {row.present && total > 0 ? (
                  <div className="mt-3">
                    <UsageBar usedPct={usedPct} markerPct={markerPct} alerting={alerting} />
                    <div className="mt-1.5 flex items-center justify-between gap-2 text-[11px]">
                      <span className="text-muted-foreground">
                        {formatBytes(free)} free of {formatBytes(total)} · {Math.round(usedPct)}% used
                      </span>
                      {alerting && (
                        <span className="inline-flex items-center gap-1 font-medium text-rose-400">
                          <AlertTriangle className="h-3 w-3" />
                          Below threshold
                        </span>
                      )}
                    </div>
                  </div>
                ) : (
                  <div className="mt-2 text-xs text-muted-foreground">Not currently reachable</div>
                )}

                <div className="mt-3 flex items-center justify-between gap-2">
                  <Label htmlFor={`minfree-${row.diskId}`} className="text-sm text-muted-foreground">
                    Alert below
                  </Label>
                  <div className="flex items-center gap-2">
                    <Input
                      id={`minfree-${row.diskId}`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={row.minFreeGb}
                      onChange={(e) => updateRow(row.diskId, { minFreeGb: e.target.value })}
                      className="w-24 h-8 text-sm text-right"
                    />
                    <span className="text-sm text-muted-foreground">GB free</span>
                  </div>
                </div>
              </div>
            );
          })}
          <div className="px-4 py-3">
            <Button variant="outline" className="w-full h-9" onClick={save} disabled={saving}>
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Saving…
                </>
              ) : (
                'Save low-space alerts'
              )}
            </Button>
          </div>
        </>
      )}
    </GroupedSection>
  );
}
