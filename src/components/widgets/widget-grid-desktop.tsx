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

interface WidgetGridDesktopProps {
  refreshInterval: number;
}

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
  refreshInterval,
  editMode,
  onRemove,
  colSpan,
  rowSpan,
  narrow = false,
}: {
  instance: WidgetInstance;
  refreshInterval: number;
  editMode: boolean;
  onRemove: (id: string) => void;
  /** Effective column span — defaults to instance.colSpan (desktop). */
  colSpan?: number;
  /** Effective row span — defaults to instance.rowSpan (desktop). */
  rowSpan?: number;
  /** Pick the widget's mobile layout variant when true. */
  narrow?: boolean;
}) {
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const definition = getWidgetDefinition(instance.widgetId, discoverLayout);
  if (!definition) return null;
  const effectiveCol = colSpan ?? instance.colSpan;
  const effectiveRow = rowSpan ?? instance.rowSpan;
  const baseVariant = narrow
    ? definition.mobileLayout ?? 'default'
    : definition.desktopLayout ?? 'default';
  const variant = instance.layoutOverride ?? baseVariant;

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
        refreshInterval={refreshInterval}
        editMode={editMode}
        narrow={narrow}
        colSpan={effectiveCol}
        rowSpan={effectiveRow}
        layoutVariant={variant}
      />
    </BentoCell>
  );
}

export function WidgetGridDesktop({ refreshInterval }: WidgetGridDesktopProps) {
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
              refreshInterval={refreshInterval}
              editMode={editMode}
              onRemove={removeWidget}
            />
          </div>
        ))}
      </ResponsiveGrid>
    </div>
  );
}
