'use client';

import { useMemo } from 'react';
import { Settings2, TimerReset, Trash2 } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import type { WidgetInstance } from '@/lib/widgets/types';
import { useMe, hasCapabilities } from '@/components/permission-provider';
import { BentoCell, BentoEditChrome } from './bento-cell';
import { WidgetRenderer } from './widget-renderer';
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

  return useMemo(
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
        {
          id: 'customize',
          label: 'Customize dashboard',
          icon: <Settings2 />,
          onSelect: () => setEditMode(true),
        },
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
      actions: [{
        id: 'remove',
        label: 'Remove widget',
        icon: <Trash2 />,
        destructive: true,
        onSelect: () => {
          setEditMode(true);
          onRemove(instance.id);
        },
      }],
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
