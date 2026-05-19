'use client';

import { useMemo } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useUIStore } from '@/lib/store';
import type { ColSpan, RowSpan, WidgetInstance } from '@/lib/widgets/types';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { useDashboardLayout } from './dashboard-layout-context';
import { BentoCell, BentoEditChrome } from './bento-cell';
import { WidgetRenderer } from './widget-renderer';
import { ThemeInspector } from './theme-inspector';
import { HPR, mix } from './bento-primitives';

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
}) {
  const discoverLayout = useUIStore((s) => s.discoverLayout);
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

  return (
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
  );
}

export function WidgetGridDesktop() {
  const { widgets: dashboardLayout, removeWidget, updateWidgetPositions } = useDashboardLayout();
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const discoverLayout = useUIStore((s) => s.discoverLayout);

  const visibleWidgets = useMemo(
    () => dashboardLayout.filter((instance) => getWidgetDefinition(instance.widgetId, discoverLayout)),
    [dashboardLayout, discoverLayout],
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
            />
          </div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}
