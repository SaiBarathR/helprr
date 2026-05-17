'use client';

import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toast } from 'sonner';
import type { ColSpan, RowSpan, WidgetInstance, WidgetLayoutVariant } from '@/lib/widgets/types';
import { DEFAULT_LAYOUT, getWidgetDefinition } from '@/lib/widgets/registry';
import {
  DASHBOARD_DESKTOP_COLS,
  DASHBOARD_MOBILE_COLS,
  clampMobileColSpan,
  clampRowSpan,
  placeWidgetInFirstGap,
  placeWidgetInFirstMobileGap,
} from '@/lib/widgets/sanitize';
import { useUIStore } from '@/lib/store';

interface DashboardLayoutContextValue {
  widgets: WidgetInstance[];
  setWidgets: (next: WidgetInstance[]) => void;
  addWidget: (widgetId: string) => void;
  removeWidget: (instanceId: string) => void;
  updateWidgetPositions: (positions: Array<{ id: string; x: number; y: number; colSpan?: ColSpan; rowSpan?: RowSpan }>) => void;
  updateMobileWidgetPositions: (positions: Array<{ id: string; x: number; y: number; colSpan?: ColSpan; rowSpan?: RowSpan }>) => void;
  setWidgetLayoutOverride: (instanceId: string, variant: WidgetLayoutVariant | null) => void;
  resetWidgets: () => void;
  isDirty: boolean;
  initialWidgets: WidgetInstance[];
}

const DashboardLayoutContext = createContext<DashboardLayoutContextValue | null>(null);

// Cheap structural compare keyed on the fields that actually round-trip to the
// server. Avoids JSON.stringify on every onLayoutChange tick during drags.
function widgetsDiffer(a: WidgetInstance[], b: WidgetInstance[]): boolean {
  if (a === b) return false;
  if (a.length !== b.length) return true;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i];
    const y = b[i];
    if (
      x.id !== y.id
      || x.widgetId !== y.widgetId
      || x.x !== y.x
      || x.y !== y.y
      || x.colSpan !== y.colSpan
      || x.rowSpan !== y.rowSpan
      || x.mobileX !== y.mobileX
      || x.mobileY !== y.mobileY
      || x.mobileColSpan !== y.mobileColSpan
      || x.mobileRowSpan !== y.mobileRowSpan
      || x.layoutOverride !== y.layoutOverride
    ) {
      return true;
    }
  }
  return false;
}

export function useDashboardLayout(): DashboardLayoutContextValue {
  const ctx = useContext(DashboardLayoutContext);
  if (!ctx) throw new Error('useDashboardLayout must be used inside DashboardLayoutProvider');
  return ctx;
}

interface DashboardLayoutProviderProps {
  initialWidgets: WidgetInstance[];
  /** The active DashboardLayout row id — used by `setWidgetLayoutOverride`
   *  to auto-save the view-mode toggle without going through edit mode. */
  activeLayoutId: string;
  children: ReactNode;
}

export function DashboardLayoutProvider({ initialWidgets, activeLayoutId, children }: DashboardLayoutProviderProps) {
  const [widgets, setWidgetsState] = useState<WidgetInstance[]>(initialWidgets);
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const dashboardEditMode = useUIStore((s) => s.dashboardEditMode);
  // Mirror edit mode into a ref so the auto-save closure reads the live value
  // without re-binding on every state change. Without this, the toggle would
  // bake in whatever editMode was when the override was created.
  const editModeRef = useRef(dashboardEditMode);
  editModeRef.current = dashboardEditMode;
  // Mirror the latest widgets so setWidgetLayoutOverride can compute the next
  // array deterministically OUTSIDE of setWidgetsState — reading state from a
  // side-effect inside the updater is unreliable under React 18 (the updater
  // may double-invoke or run later than expected).
  const widgetsRef = useRef<WidgetInstance[]>(initialWidgets);
  widgetsRef.current = widgets;
  const overrideSaveRef = useRef<AbortController | null>(null);

  const setWidgets = useCallback((next: WidgetInstance[]) => {
    setWidgetsState(next);
  }, []);

  // IMPORTANT: none of these mutations call sanitize* — those helpers drop
  // any widget whose definition isn't currently resolvable, which destroys
  // discover-* widgets in the working set whenever the zustand `discoverLayout`
  // happens to be null (e.g. on first page load, before DiscoverLayoutHydrator
  // finishes its fetch). react-grid-layout fires `onLayoutChange` during its
  // initial measurement — so even a passive mount would silently strip every
  // discover widget the user added. Validation/sanitization still runs on the
  // server in `updateLayout`, which is the right boundary.
  const addWidget = useCallback((widgetId: string) => {
    setWidgetsState((current) => {
      const def = getWidgetDefinition(widgetId, discoverLayout);
      if (!def) return current;
      const count = current.filter((w) => w.widgetId === widgetId).length;
      const instance: WidgetInstance = {
        id: `${widgetId}-${count + 1}-${Date.now()}`,
        widgetId,
        colSpan: def.defaultDesktopSpan.colSpan,
        rowSpan: def.defaultDesktopSpan.rowSpan,
        mobileColSpan: clampMobileColSpan(def.defaultMobileSpan.colSpan, 1),
        mobileRowSpan: def.defaultMobileSpan.rowSpan,
      };
      const placedDesktop = placeWidgetInFirstGap(current, instance);
      const placedBoth = placeWidgetInFirstMobileGap(current, placedDesktop);
      return [...current, placedBoth];
    });
  }, [discoverLayout]);

  const removeWidget = useCallback((instanceId: string) => {
    setWidgetsState((current) => current.filter((w) => w.id !== instanceId));
  }, []);

  const updateWidgetPositions = useCallback((positions: Array<{ id: string; x: number; y: number; colSpan?: ColSpan; rowSpan?: RowSpan }>) => {
    setWidgetsState((current) => {
      const byId = new Map(positions.map((p) => [p.id, p]));
      return current.map((w) => {
        const p = byId.get(w.id);
        if (!p) return w;
        return {
          ...w,
          x: Math.min(
            DASHBOARD_DESKTOP_COLS - (p.colSpan ?? w.colSpan),
            Math.max(0, Math.floor(p.x)),
          ),
          y: Math.max(0, Math.floor(p.y)),
          colSpan: p.colSpan ?? w.colSpan,
          rowSpan: p.rowSpan ?? w.rowSpan,
        };
      });
    });
  }, []);

  const updateMobileWidgetPositions = useCallback((positions: Array<{ id: string; x: number; y: number; colSpan?: ColSpan; rowSpan?: RowSpan }>) => {
    setWidgetsState((current) => {
      const byId = new Map(positions.map((p) => [p.id, p]));
      return current.map((w) => {
        const p = byId.get(w.id);
        if (!p) return w;
        const col = clampMobileColSpan(p.colSpan ?? w.mobileColSpan, (w.mobileColSpan ?? 1) as ColSpan);
        const row = clampRowSpan(p.rowSpan ?? w.mobileRowSpan, (w.mobileRowSpan ?? 1) as RowSpan);
        return {
          ...w,
          mobileX: Math.min(
            DASHBOARD_MOBILE_COLS - col,
            Math.max(0, Math.floor(p.x)),
          ),
          mobileY: Math.max(0, Math.floor(p.y)),
          mobileColSpan: col,
          mobileRowSpan: row,
        };
      });
    });
  }, []);

  const setWidgetLayoutOverride = useCallback(
    (instanceId: string, variant: WidgetLayoutVariant | null) => {
      const next = widgetsRef.current.map((w) => {
        if (w.id !== instanceId) return w;
        if (variant == null) {
          const stripped = { ...w };
          delete stripped.layoutOverride;
          return stripped;
        }
        return { ...w, layoutOverride: variant };
      });
      setWidgetsState(next);
      // While in edit mode the user has unsaved drags in the working set; an
      // auto-save here would silently persist those positions and break the
      // "Discard" button. The override sticks in local state regardless — the
      // user's explicit Save (or Done) will flush it together with their edits.
      if (editModeRef.current) return;
      // Auto-save: PUT the updated layout. Abort any in-flight save first so a
      // rapid double-tap doesn't race itself into a stale write.
      overrideSaveRef.current?.abort();
      const controller = new AbortController();
      overrideSaveRef.current = controller;
      void (async () => {
        try {
          const res = await fetch(`/api/dashboard-layouts/${activeLayoutId}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ widgets: next }),
            signal: controller.signal,
          });
          if (!res.ok) {
            const payload = await res.json().catch(() => ({}));
            throw new Error(payload?.error ?? 'Failed to save view');
          }
        } catch (error) {
          if ((error as Error)?.name === 'AbortError') return;
          toast.error(error instanceof Error ? error.message : 'Failed to save view');
        }
      })();
    },
    [activeLayoutId],
  );

  const resetWidgets = useCallback(() => {
    setWidgetsState(DEFAULT_LAYOUT.map((w) => ({ ...w })));
  }, []);

  const isDirty = useMemo(
    () => widgetsDiffer(widgets, initialWidgets),
    [widgets, initialWidgets],
  );

  const value = useMemo<DashboardLayoutContextValue>(() => ({
    widgets,
    setWidgets,
    addWidget,
    removeWidget,
    updateWidgetPositions,
    updateMobileWidgetPositions,
    setWidgetLayoutOverride,
    resetWidgets,
    isDirty,
    initialWidgets,
  }), [widgets, setWidgets, addWidget, removeWidget, updateWidgetPositions, updateMobileWidgetPositions, setWidgetLayoutOverride, resetWidgets, isDirty, initialWidgets]);

  return (
    <DashboardLayoutContext.Provider value={value}>
      {children}
    </DashboardLayoutContext.Provider>
  );
}
