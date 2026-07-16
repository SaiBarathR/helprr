'use client';

import { useMemo } from 'react';
import { Settings2, TimerReset, Trash2 } from 'lucide-react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useUIStore } from '@/lib/store';
import type { ColSpan, RowSpan, WidgetInstance } from '@/lib/widgets/types';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { useMe, hasCapabilities } from '@/components/permission-provider';
import { useDashboardLayout } from './dashboard-layout-context';
import { BentoCell, BentoEditChrome } from './bento-cell';
import { WidgetRenderer } from './widget-renderer';
import { ThemeInspector } from './theme-inspector';
import { HPR, mix } from './bento-primitives';
import { QuickContextMenu, type ContextActionGroup } from '@/components/ui/quick-context-menu';

const ResponsiveGrid = WidthProvider(GridLayout);

export const WIDGET_HUE: Record<string, string> = {
  'stats-grid': mix(HPR.amber, 5),
  'now-streaming': mix(HPR.cyan, 5),
  'prowlarr-indexers': mix(HPR.violet, 5),
  'wanted-items': mix(HPR.amber, 5),
  'torrent-overview': mix(HPR.blue, 5),
  'continue-watching': mix(HPR.cyan, 4),
};

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
  /** Effective column span — defaults to instance.colSpan (desktop). */
  colSpan?: number;
  /** Effective row span — defaults to instance.rowSpan (desktop). */
  rowSpan?: number;
  /** Pick the widget's mobile layout variant when true. */
  narrow?: boolean;
  /** True when this item is rendered inside the mobile grid. Drives which
   *  per-instance override field wins. */
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
  // Device-wise resolution: the mobile grid reads its own override first,
  // then falls back to the legacy shared `layoutOverride` so layouts saved
  // before this split keep rendering the way they used to.
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

export function WidgetGridDesktop({ onConfigureRefresh }: { onConfigureRefresh: () => void }) {
  const { widgets: dashboardLayout, removeWidget, updateWidgetPositions } = useDashboardLayout();
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const me = useMe();

  const visibleWidgets = useMemo(
    () =>
      dashboardLayout.filter((instance) => {
        const def = getWidgetDefinition(instance.widgetId, discoverLayout);
        // Drop widgets the user lacks the capability for (e.g. cleanup for members)
        // or that are admin-only (AniList account carousels).
        return (
          !!def &&
          (!def.requiredCapability || hasCapabilities(me, def.requiredCapability)) &&
          (!def.adminOnly || me?.role === 'admin')
        );
      }),
    [dashboardLayout, discoverLayout, me],
  );

  const layoutItems: Layout = useMemo(
    () => visibleWidgets.map((instance) => ({
      i: instance.id,
      x: instance.x ?? 0,
      y: instance.y ?? 0,
      w: instance.colSpan,
      h: instance.rowSpan,
      minW: 2,
      maxW: 12,
      minH: 1,
      static: !editMode,
    })),
    [visibleWidgets, editMode],
  );

  function handleLayoutChange(newLayout: Layout) {
    updateWidgetPositions(
      newLayout.map((item) => ({
        id: item.i,
        x: item.x,
        y: item.y,
        colSpan: item.w as ColSpan,
        rowSpan: item.h as RowSpan,
      })),
    );
  }

  return (
    <div style={{ ['--hpr-cols' as string]: '12' } as React.CSSProperties}>
      {editMode && <ThemeInspector mobile={false} />}
      <ResponsiveGrid
        className="dashboard-bento-grid-rgl"
        cols={12}
        rowHeight={90}
        margin={[10, 10]}
        containerPadding={[0, 0]}
        isResizable={editMode}
        resizeHandles={['se']}
        isDraggable={editMode}
        useCSSTransforms
        draggableHandle=".bento-drag-handle"
        layout={layoutItems}
        onLayoutChange={handleLayoutChange}
      >
        {visibleWidgets.map((instance) => (
          <div key={instance.id} data-widget-id={instance.id}>
            <WidgetGridItem
              instance={instance}
              editMode={editMode}
              onRemove={removeWidget}
              onConfigureRefresh={onConfigureRefresh}
            />
          </div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}
