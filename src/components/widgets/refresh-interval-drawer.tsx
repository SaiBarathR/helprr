'use client';

import { useState } from 'react';
import {
  Activity, AlertTriangle, BarChart, BarChart3, Bell, Building2, Calendar,
  CalendarDays, Clock, Database, Download, Film, Filter, HardDrive, HelpCircle,
  History, Layers, MonitorPlay, PlayCircle, RotateCcw, Search, Server,
  ShieldAlert, Sparkles, Square, Tags, Timer, Tv, Users, XCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  Drawer,
  DrawerContent,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useUIStore } from '@/lib/store';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import {
  WIDGET_REFRESH_MAX_SECS,
  WIDGET_REFRESH_MIN_SECS,
} from '@/lib/widgets/definitions';
import { useDashboardLayout } from './dashboard-layout-context';

const WIDGET_ICONS: Record<string, LucideIcon> = {
  Activity, BarChart, BarChart3, Bell, Building2, Calendar, CalendarDays,
  Clock, Database, Download, Film, Filter, HardDrive, History, Layers,
  MonitorPlay, PlayCircle, Search, Server, ShieldAlert, Sparkles, Tags,
  Timer, Tv, Users, XCircle,
};

function getIcon(name: string): LucideIcon {
  return WIDGET_ICONS[name] ?? Square;
}

interface RefreshIntervalDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  layoutName: string;
}

export function RefreshIntervalDrawer({
  open,
  onOpenChange,
  layoutName,
}: RefreshIntervalDrawerProps) {
  const { widgets, setWidgetRefreshInterval } = useDashboardLayout();
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  // Local input drafts keyed by instance id. The committed value lives in the
  // widgets array (refreshIntervalSecs) — drafts let us show partially-typed
  // numbers without round-tripping through the parent state.
  // NOTE: do NOT key the Drawer on widgets — that remounts it on every
  // keystroke (since refreshIntervalSecs is part of widgets), causing the
  // input to lose focus mid-typing. The parent DashboardLayoutProvider
  // already remounts this whole subtree on actual layout switches.
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  function getDraft(instanceId: string, current: number | undefined): string {
    const draft = drafts[instanceId];
    if (draft !== undefined) return draft;
    return current !== undefined ? String(current) : '';
  }

  function commitDraft(instanceId: string, raw: string) {
    setDrafts((prev) => ({ ...prev, [instanceId]: raw }));
    if (raw.trim() === '') {
      setWidgetRefreshInterval(instanceId, undefined);
      return;
    }
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) return;
    setWidgetRefreshInterval(instanceId, Math.floor(parsed));
  }

  function resetInstance(instanceId: string) {
    setDrafts((prev) => ({ ...prev, [instanceId]: '' }));
    setWidgetRefreshInterval(instanceId, undefined);
  }

  function isValid(value: number | undefined): boolean {
    if (value === undefined) return true;
    return value >= WIDGET_REFRESH_MIN_SECS && value <= WIDGET_REFRESH_MAX_SECS;
  }

  return (
    <Drawer open={open} onOpenChange={onOpenChange}>
      <DrawerContent>
        <DrawerHeader>
          <DrawerTitle>Refresh intervals · {layoutName}</DrawerTitle>
        </DrawerHeader>
        <p className="px-4 text-xs text-muted-foreground">
          Leave a field empty to use the widget&apos;s built-in default.
          Range: {WIDGET_REFRESH_MIN_SECS}–{WIDGET_REFRESH_MAX_SECS} seconds. Changes
          save when you save the layout.
        </p>
        <div className="flex-1 min-h-0 overflow-y-auto px-4 pb-8 pt-3">
          {widgets.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-8">
              No widgets in this layout yet.
            </p>
          ) : (
            <ul className="divide-y divide-[oklch(1_0_0/6%)] rounded-lg border border-[oklch(1_0_0/8%)] bg-[oklch(1_0_0/2%)]">
              {widgets.map((inst) => {
                const def = getWidgetDefinition(inst.widgetId, discoverLayout);
                const current = inst.refreshIntervalSecs;
                const draft = getDraft(inst.id, current);
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
                    className="px-3 py-3 flex items-center gap-3"
                  >
                    <Icon className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                    <div className="flex-1 min-w-0">
                      <div className="text-sm truncate">
                        {def?.name ?? `Unknown (${inst.widgetId})`}
                      </div>
                      <div className="text-xs text-muted-foreground truncate">
                        default {defaultSecs}s
                      </div>
                      {!valid && (
                        <div className="text-xs text-red-500 mt-0.5">
                          Must be {WIDGET_REFRESH_MIN_SECS}–{WIDGET_REFRESH_MAX_SECS}
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
                        onChange={(e) => commitDraft(inst.id, e.target.value)}
                        className={`w-20 h-8 text-sm ${!valid ? 'border-red-500' : ''}`}
                      />
                      <span className="text-xs text-muted-foreground w-4">s</span>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7"
                        onClick={() => resetInstance(inst.id)}
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
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
