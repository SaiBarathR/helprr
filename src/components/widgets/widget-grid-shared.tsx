'use client';

import { useEffect, useMemo } from 'react';
import { Settings2, TimerReset, Trash2 } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { hasRequiredWidgetServices } from '@/lib/widgets/availability';
import { useConfiguredWidgetServices } from '@/lib/widgets/widget-availability-context';
import type { WidgetInstance } from '@/lib/widgets/types';
import { useMe, useCan, hasCapabilities } from '@/components/permission-provider';
import { BentoCell, BentoEditChrome } from './bento-cell';
import { WidgetRenderer } from './widget-renderer';
import { preloadWidgetCode } from './widget-loaders';
import { HPR, mix } from './bento-primitives';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';

export const WIDGET_HUE: Record<string, string> = {
  'stats-grid': mix(HPR.amber, 5),
  'now-streaming': mix(HPR.cyan, 5),
  'prowlarr-indexers': mix(HPR.violet, 5),
  'wanted-items': mix(HPR.amber, 5),
  'torrent-overview': mix(HPR.blue, 5),
  'continue-watching': mix(HPR.cyan, 4),
};

export function useVisibleDashboardWidgets(dashboardLayout: WidgetInstance[]) {
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const me = useMe();
  const configuredServices = useConfiguredWidgetServices();

  const visible = useMemo(
    () =>
      dashboardLayout.filter((instance) => {
        const def = getWidgetDefinition(instance.widgetId, discoverLayout);
        return (
          !!def &&
          (!def.requiredCapability || hasCapabilities(me, def.requiredCapability)) &&
          (!def.adminOnly || me?.role === 'admin')
        );
      }),
    [dashboardLayout, discoverLayout, me],
  );

  // Once the page is idle, fetch the code of every widget on it that will
  // mount, so the service worker has it if the connection drops before the
  // user scrolls to them. Without it a widget below the fold showed an error
  // offline. Offline (a cold start from the saved shell), it waits for the
  // network; each time the network returns it fetches again, which costs
  // nothing for code the page already has.
  const preloadKey = JSON.stringify([...new Set(visible
    .filter((instance) => {
      const def = getWidgetDefinition(instance.widgetId, discoverLayout);
      return !!def && hasRequiredWidgetServices(def, configuredServices);
    })
    .map((instance) => instance.widgetId))].sort());
  useEffect(() => {
    const ids: string[] = JSON.parse(preloadKey);
    if (ids.length === 0) return;
    const idle = globalThis as typeof globalThis & {
      requestIdleCallback?: (callback: () => void, options?: { timeout: number }) => number;
      cancelIdleCallback?: (handle: number) => void;
    };
    let cancel = () => {};
    const schedule = () => {
      cancel();
      const preload = () => { for (const id of ids) preloadWidgetCode(id); };
      if (idle.requestIdleCallback) {
        const handle = idle.requestIdleCallback(preload, { timeout: 5_000 });
        cancel = () => idle.cancelIdleCallback?.(handle);
      } else {
        // Safari has no requestIdleCallback.
        const timer = setTimeout(preload, 2_000);
        cancel = () => clearTimeout(timer);
      }
    };
    if (globalThis.navigator.onLine) schedule();
    window.addEventListener('online', schedule);
    return () => {
      cancel();
      window.removeEventListener('online', schedule);
    };
  }, [preloadKey]);

  return visible;
}

export function WidgetGridItem({
  instance,
  editMode,
  onRemove,
  colSpan,
  rowSpan,
  narrow = false,
  mobileGrid = false,
  onConfigureRefresh,
}: {
  instance: WidgetInstance;
  editMode: boolean;
  onRemove: (id: string) => void;
  /** Effective column span - defaults to instance.colSpan (desktop). */
  colSpan?: number;
  /** Effective row span - defaults to instance.rowSpan (desktop). */
  rowSpan?: number;
  /** Pick the widget's mobile layout variant when true. */
  narrow?: boolean;
  /** True when rendered inside the mobile grid. */
  mobileGrid?: boolean;
  onConfigureRefresh: () => void;
}) {
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const setEditMode = useUIStore((s) => s.setDashboardEditMode);
  // UX only, like the dashboard's Edit row: the layout routes check
  // dashboard.customize themselves.
  const canCustomize = useCan('dashboard.customize');
  const definition = getWidgetDefinition(instance.widgetId, discoverLayout);
  if (!definition) return null;
  const effectiveCol = colSpan ?? instance.colSpan;
  const effectiveRow = rowSpan ?? instance.rowSpan;
  const baseVariant = narrow
    ? definition.mobileLayout ?? 'default'
    : definition.desktopLayout ?? 'default';
  const variant = mobileGrid
    ? instance.mobileLayoutOverride ?? instance.layoutOverride ?? baseVariant
    : instance.layoutOverride ?? baseVariant;

  const contextGroups: ContextActionGroup[] = [
    {
      id: 'dashboard',
      actions: [
        ...(canCustomize ? [{
          id: 'customize',
          label: 'Customize dashboard',
          icon: <Settings2 />,
          onSelect: () => setEditMode(true),
        }] : []),
        {
          id: 'refresh',
          label: 'Configure refresh intervals',
          icon: <TimerReset />,
          onSelect: onConfigureRefresh,
        },
      ],
    },
    {
      id: 'danger',
      // Left empty without the capability, so the menu drops the group.
      actions: canCustomize ? [{
        id: 'remove',
        label: 'Remove widget',
        icon: <Trash2 />,
        destructive: true,
        onSelect: () => {
          setEditMode(true);
          onRemove(instance.id);
        },
      }] : [],
    },
  ];

  return (
    <QuickContextMenu label={`${definition.name} widget actions`} groups={contextGroups} disabled={editMode}>
      <BentoCell
        colSpan={effectiveCol}
        rowSpan={effectiveRow}
        edit={editMode}
        narrow={narrow}
        hue={WIDGET_HUE[instance.widgetId] ?? null}
        chrome={
          <BentoEditChrome
            onRemove={() => onRemove(instance.id)}
          />
        }
      >
        <WidgetRenderer
          instance={instance}
          editMode={editMode}
          narrow={narrow}
          colSpan={effectiveCol}
          rowSpan={effectiveRow}
          layoutVariant={variant}
          mobileGrid={mobileGrid}
        />
      </BentoCell>
    </QuickContextMenu>
  );
}
