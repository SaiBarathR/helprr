'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ApiError, jsonFetcher } from '@/lib/query-fetch';
import Link from 'next/link';
import { toast } from 'sonner';
import {
  ChevronLeft, ChevronDown, RotateCcw, AlertTriangle, Loader2,
  Activity, BarChart, BarChart3, Bell, Building2, Calendar, CalendarDays,
  Clock, Database, Download, Film, Filter, HardDrive, HelpCircle, History,
  Layers, MonitorPlay, PlayCircle, Search, Server, ShieldAlert, Sparkles,
  Square, Tags, Timer, Tv, Users, XCircle,
  type LucideIcon,
} from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import {
  WIDGET_REFRESH_MIN_SECS,
  WIDGET_REFRESH_MAX_SECS,
} from '@/lib/widgets/definitions';
import type { WidgetInstance } from '@/lib/widgets/types';

interface LayoutRecord {
  id: string;
  name: string;
  widgets: WidgetInstance[];
  createdAt: string;
  updatedAt: string;
}

interface LayoutsResponse {
  layouts: LayoutRecord[];
  defaultDesktopLayoutId: string | null;
  defaultMobileLayoutId: string | null;
}

type OverrideMap = Record<string, Record<string, number | undefined>>;

const WIDGET_ICONS: Record<string, LucideIcon> = {
  Activity, BarChart, BarChart3, Bell, Building2, Calendar, CalendarDays,
  Clock, Database, Download, Film, Filter, HardDrive, History, Layers,
  MonitorPlay, PlayCircle, Search, Server, ShieldAlert, Sparkles, Tags,
  Timer, Tv, Users, XCircle,
};

function getIcon(name: string): LucideIcon {
  return WIDGET_ICONS[name] ?? Square;
}

export default function DashboardRefreshSettingsPage() {
  const [overrides, setOverrides] = useState<OverrideMap>({});
  const [drafts, setDrafts] = useState<Record<string, Record<string, string>>>({});
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const queryClient = useQueryClient();

  const layoutsQuery = useQuery({
    queryKey: ['dashboard-layouts'],
    queryFn: jsonFetcher<LayoutsResponse>('/api/dashboard-layouts'),
    // Edit form: don't let a background refetch change `data` (and thus the dirty
    // calc) mid-edit. Only mount + the post-save invalidate refresh it.
    staleTime: Infinity,
    refetchOnReconnect: false,
  });
  const data = layoutsQuery.data ?? null;
  const loading = layoutsQuery.isLoading;

  // Seed the editable override/draft/expanded state once from the loaded layouts.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current || !data) return;
    seeded.current = true;
    const initial: OverrideMap = {};
    const initialDrafts: Record<string, Record<string, string>> = {};
    const initialExpanded: Record<string, boolean> = {};
    for (const layout of data.layouts) {
      initial[layout.id] = {};
      initialDrafts[layout.id] = {};
      for (const inst of layout.widgets) {
        initial[layout.id][inst.id] = inst.refreshIntervalSecs;
        initialDrafts[layout.id][inst.id] =
          inst.refreshIntervalSecs !== undefined ? String(inst.refreshIntervalSecs) : '';
      }
      initialExpanded[layout.id] =
        layout.id === data.defaultDesktopLayoutId
        || layout.id === data.defaultMobileLayoutId;
    }
    setOverrides(initial);
    setDrafts(initialDrafts);
    setExpanded(initialExpanded);
  }, [data]);

  const dirty = useMemo(() => {
    if (!data) return false;
    for (const layout of data.layouts) {
      for (const inst of layout.widgets) {
        const current = overrides[layout.id]?.[inst.id];
        const original = inst.refreshIntervalSecs;
        if (current !== original) return true;
      }
    }
    return false;
  }, [data, overrides]);

  const dirtyLayoutIds = useMemo(() => {
    if (!data) return new Set<string>();
    const set = new Set<string>();
    for (const layout of data.layouts) {
      for (const inst of layout.widgets) {
        const current = overrides[layout.id]?.[inst.id];
        const original = inst.refreshIntervalSecs;
        if (current !== original) {
          set.add(layout.id);
          break;
        }
      }
    }
    return set;
  }, [data, overrides]);

  function commitDraft(layoutId: string, instanceId: string, raw: string) {
    setDrafts((prev) => ({
      ...prev,
      [layoutId]: { ...prev[layoutId], [instanceId]: raw },
    }));
    if (raw.trim() === '') {
      setOverrides((prev) => ({
        ...prev,
        [layoutId]: { ...prev[layoutId], [instanceId]: undefined },
      }));
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    const clamped = Math.floor(parsed);
    setOverrides((prev) => ({
      ...prev,
      [layoutId]: { ...prev[layoutId], [instanceId]: clamped },
    }));
  }

  function resetInstance(layoutId: string, instanceId: string) {
    setDrafts((prev) => ({
      ...prev,
      [layoutId]: { ...prev[layoutId], [instanceId]: '' },
    }));
    setOverrides((prev) => ({
      ...prev,
      [layoutId]: { ...prev[layoutId], [instanceId]: undefined },
    }));
  }

  function resetLayout(layoutId: string) {
    if (!data) return;
    const layout = data.layouts.find((l) => l.id === layoutId);
    if (!layout) return;
    const nextDrafts: Record<string, string> = {};
    const nextOverrides: Record<string, number | undefined> = {};
    for (const inst of layout.widgets) {
      nextDrafts[inst.id] = '';
      nextOverrides[inst.id] = undefined;
    }
    setDrafts((prev) => ({ ...prev, [layoutId]: nextDrafts }));
    setOverrides((prev) => ({ ...prev, [layoutId]: nextOverrides }));
  }

  function discardAll() {
    if (!data) return;
    const initial: OverrideMap = {};
    const initialDrafts: Record<string, Record<string, string>> = {};
    for (const layout of data.layouts) {
      initial[layout.id] = {};
      initialDrafts[layout.id] = {};
      for (const inst of layout.widgets) {
        initial[layout.id][inst.id] = inst.refreshIntervalSecs;
        initialDrafts[layout.id][inst.id] =
          inst.refreshIntervalSecs !== undefined ? String(inst.refreshIntervalSecs) : '';
      }
    }
    setOverrides(initial);
    setDrafts(initialDrafts);
  }

  function isValid(value: number | undefined): boolean {
    if (value === undefined) return true;
    return value >= WIDGET_REFRESH_MIN_SECS && value <= WIDGET_REFRESH_MAX_SECS;
  }

  const hasInvalid = useMemo(() => {
    if (!data) return false;
    for (const layout of data.layouts) {
      for (const inst of layout.widgets) {
        if (!isValid(overrides[layout.id]?.[inst.id])) return true;
      }
    }
    return false;
  }, [data, overrides]);

  const saveMutation = useMutation({
    mutationFn: async (layoutsToSave: LayoutRecord[]) => {
      const succeeded: string[] = [];
      const failed: string[] = [];
      for (const layout of layoutsToSave) {
        const updatedWidgets = layout.widgets.map((inst) => {
          const value = overrides[layout.id]?.[inst.id];
          const next: WidgetInstance = { ...inst, refreshIntervalSecs: value };
          if (value === undefined) delete next.refreshIntervalSecs;
          return next;
        });
        const res = await fetch(`/api/dashboard-layouts/${layout.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ widgets: updatedWidgets }),
        });
        // A 401 means the session was revoked — bail to the global MutationCache
        // handler (redirect to /login) instead of recording it as a failed layout.
        if (res.status === 401) throw new ApiError(401, 'Session expired');
        if (!res.ok) {
          failed.push(layout.name);
          continue;
        }
        succeeded.push(layout.name);
      }
      return { succeeded, failed };
    },
    onSuccess: ({ succeeded, failed }) => {
      if (failed.length === 0) {
        toast.success('Refresh intervals saved');
      } else if (succeeded.length === 0) {
        toast.error(`Failed to save: ${failed.join(', ')}`);
      } else {
        toast.warning(
          `Saved ${succeeded.length}, failed ${failed.length}: ${failed.join(', ')}`,
        );
      }
      queryClient.invalidateQueries({ queryKey: ['dashboard-layouts'] });
    },
    onError: (err) => {
      // 401 is handled globally (redirect to /login); only toast other failures.
      if (err instanceof ApiError && err.status === 401) return;
      toast.error('Failed to save refresh intervals');
    },
  });
  const saving = saveMutation.isPending;

  function handleSave() {
    if (!data || !dirty || hasInvalid) return;
    saveMutation.mutate(data.layouts.filter((l) => dirtyLayoutIds.has(l.id)));
  }

  return (
    <div className="px-4 sm:px-6 py-4 max-w-3xl mx-auto pb-32">
      <div className="flex items-center gap-2 mb-4">
        <Button variant="ghost" size="sm" asChild className="h-8 -ml-2 px-2">
          <Link href="/settings/preferences">
            <ChevronLeft className="h-4 w-4" />
            Preferences
          </Link>
        </Button>
      </div>

      <div className="mb-6">
        <h1 className="text-2xl font-semibold">Dashboard Widget Refresh</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Configure how often each widget polls for fresh data. Leave a field empty
          to use the widget&apos;s built-in default. Range: {WIDGET_REFRESH_MIN_SECS}–{WIDGET_REFRESH_MAX_SECS} seconds.
        </p>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground">
          <Loader2 className="h-5 w-5 animate-spin mr-2" />
          Loading layouts…
        </div>
      ) : !data || data.layouts.length === 0 ? (
        <div className="text-sm text-muted-foreground py-12 text-center">
          No dashboard layouts yet. Create one from the dashboard first.
        </div>
      ) : (
        <div className="space-y-3">
          {data.layouts.map((layout) => {
            const isExpanded = expanded[layout.id] ?? false;
            const isDefault =
              layout.id === data.defaultDesktopLayoutId
              || layout.id === data.defaultMobileLayoutId;
            const role =
              [
                layout.id === data.defaultDesktopLayoutId ? 'desktop default' : null,
                layout.id === data.defaultMobileLayoutId ? 'mobile default' : null,
              ]
                .filter(Boolean)
                .join(' · ');
            return (
              <div
                key={layout.id}
                className="rounded-lg border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/2%)]"
              >
                <button
                  type="button"
                  onClick={() =>
                    setExpanded((prev) => ({ ...prev, [layout.id]: !isExpanded }))
                  }
                  className="w-full flex items-center justify-between px-4 py-3 text-left"
                >
                  <div className="flex flex-col gap-0.5">
                    <div className="flex items-center gap-2">
                      <span className="font-medium">{layout.name}</span>
                      {isDefault && (
                        <span className="text-[10px] uppercase tracking-wide text-muted-foreground border border-[oklch(1_0_0/12%)] rounded px-1.5 py-0.5">
                          {role}
                        </span>
                      )}
                      {dirtyLayoutIds.has(layout.id) && (
                        <span className="text-[10px] uppercase tracking-wide text-amber-500">
                          unsaved
                        </span>
                      )}
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {layout.widgets.length} widget{layout.widgets.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <ChevronDown
                    className={`h-4 w-4 text-muted-foreground transition-transform ${
                      isExpanded ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isExpanded && (
                  <div className="border-t border-[oklch(1_0_0/6%)]">
                    {layout.widgets.length === 0 ? (
                      <div className="px-4 py-6 text-sm text-muted-foreground text-center">
                        No widgets in this layout.
                      </div>
                    ) : (
                      <>
                        <div className="px-4 py-2 flex justify-end border-b border-[oklch(1_0_0/6%)]">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => resetLayout(layout.id)}
                          >
                            Reset all to defaults
                          </Button>
                        </div>
                        <ul className="divide-y divide-[oklch(1_0_0/6%)]">
                          {layout.widgets.map((inst) => {
                            const def = getWidgetDefinition(inst.widgetId, discoverLayout);
                            const draft = drafts[layout.id]?.[inst.id] ?? '';
                            const current = overrides[layout.id]?.[inst.id];
                            const valid = isValid(current);
                            const defaultSecs = def?.defaultRefreshIntervalSecs ?? 30;
                            const showHeavyWarning =
                              valid
                              && current !== undefined
                              && defaultSecs >= 60
                              && current < defaultSecs;
                            const Icon = def ? getIcon(def.icon) : HelpCircle;
                            return (
                              <li
                                key={inst.id}
                                className="px-4 py-3 flex items-center gap-3"
                              >
                                <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                                <div className="flex-1 min-w-0">
                                  <div className="text-sm truncate">
                                    {def?.name ?? `Unknown (${inst.widgetId})`}
                                  </div>
                                  <div className="text-xs text-muted-foreground truncate">
                                    {inst.id} · default {defaultSecs}s
                                  </div>
                                  {!valid && (
                                    <div className="text-xs text-red-500 mt-0.5">
                                      Must be between {WIDGET_REFRESH_MIN_SECS} and {WIDGET_REFRESH_MAX_SECS}
                                    </div>
                                  )}
                                  {showHeavyWarning && (
                                    <div className="text-xs text-amber-500 mt-0.5 flex items-center gap-1">
                                      <AlertTriangle className="h-3 w-3" />
                                      Heavy widget — short intervals may impact performance
                                    </div>
                                  )}
                                </div>
                                <div className="flex items-center gap-2">
                                  <Input
                                    type="number"
                                    inputMode="numeric"
                                    min={WIDGET_REFRESH_MIN_SECS}
                                    max={WIDGET_REFRESH_MAX_SECS}
                                    step={1}
                                    placeholder={String(defaultSecs)}
                                    value={draft}
                                    onChange={(e) =>
                                      commitDraft(layout.id, inst.id, e.target.value)
                                    }
                                    className={`w-20 h-8 text-sm ${
                                      !valid ? 'border-red-500' : ''
                                    }`}
                                  />
                                  <span className="text-xs text-muted-foreground w-4">s</span>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    className="h-7 w-7"
                                    onClick={() => resetInstance(layout.id, inst.id)}
                                    disabled={current === undefined && draft === ''}
                                    title="Reset to default"
                                  >
                                    <RotateCcw className="h-3.5 w-3.5" />
                                  </Button>
                                </div>
                              </li>
                            );
                          })}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {dirty && (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[oklch(1_0_0/8%)] bg-background/95 backdrop-blur px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <span className="text-sm text-muted-foreground">
              You have unsaved changes
              {hasInvalid && (
                <span className="text-red-500 ml-2">— fix invalid values first</span>
              )}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={discardAll} disabled={saving}>
                Discard
              </Button>
              <Button size="sm" onClick={handleSave} disabled={saving || hasInvalid}>
                {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Save changes'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
