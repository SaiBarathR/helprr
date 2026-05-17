'use client';

import { useMemo } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useUIStore } from '@/lib/store';
import type { ColSpan, RowSpan } from '@/lib/widgets/types';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { useDashboardLayout } from './dashboard-layout-context';
import { WidgetGridItem } from './widget-grid-desktop';
import { ThemeInspector } from './theme-inspector';

interface WidgetGridMobileProps {
  refreshInterval: number;
}

const MOBILE_COLS = 4;
const ResponsiveGrid = WidthProvider(GridLayout);

export function WidgetGridMobile({ refreshInterval }: WidgetGridMobileProps) {
  const { widgets: dashboardLayout, removeWidget, updateMobileWidgetPositions } = useDashboardLayout();
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const discoverLayout = useUIStore((s) => s.discoverLayout);

  const visibleWidgets = useMemo(
    () => dashboardLayout.filter((instance) => getWidgetDefinition(instance.widgetId, discoverLayout)),
    [dashboardLayout, discoverLayout],
  );

  const layoutItems: Layout = useMemo(
    () => visibleWidgets.map((instance) => {
      const def = getWidgetDefinition(instance.widgetId, discoverLayout)!;
      const col = Math.min(
        MOBILE_COLS,
        Math.max(1, (instance.mobileColSpan ?? def.defaultMobileSpan.colSpan) as number),
      );
      const row = Math.max(1, (instance.mobileRowSpan ?? def.defaultMobileSpan.rowSpan) as number);
      return {
        i: instance.id,
        x: instance.mobileX ?? 0,
        y: instance.mobileY ?? 0,
        w: col,
        h: row,
        minW: 1,
        maxW: MOBILE_COLS,
        minH: 1,
        static: !editMode,
      };
    }),
    [visibleWidgets, discoverLayout, editMode],
  );

  function handleLayoutChange(newLayout: Layout) {
    // RGL fires onLayoutChange on mount/reconciliation even with static items.
    // Without this guard, a non-edit reflow would silently persist positions.
    if (!editMode) return;
    updateMobileWidgetPositions(
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
    <div style={{ ['--hpr-cols' as string]: String(MOBILE_COLS) } as React.CSSProperties}>
      {editMode && <ThemeInspector mobile />}
      <ResponsiveGrid
        className="dashboard-bento-grid-rgl dashboard-bento-grid-rgl-mobile"
        cols={MOBILE_COLS}
        rowHeight={84}
        margin={[8, 8]}
        containerPadding={[0, 0]}
        isResizable={editMode}
        resizeHandles={['se']}
        isDraggable={editMode}
        useCSSTransforms
        draggableHandle=".bento-drag-handle"
        layout={layoutItems}
        onLayoutChange={handleLayoutChange}
      >
        {visibleWidgets.map((instance) => {
          const def = getWidgetDefinition(instance.widgetId, discoverLayout)!;
          const col = Math.min(
            MOBILE_COLS,
            Math.max(1, (instance.mobileColSpan ?? def.defaultMobileSpan.colSpan) as number),
          );
          const row = Math.max(1, (instance.mobileRowSpan ?? def.defaultMobileSpan.rowSpan) as number);
          const narrow = col <= 2;
          return (
            <div key={instance.id} data-widget-id={instance.id}>
              <WidgetGridItem
                instance={instance}
                refreshInterval={refreshInterval}
                editMode={editMode}
                onRemove={removeWidget}
                colSpan={col}
                rowSpan={row}
                narrow={narrow}
              />
            </div>
          );
        })}
      </ResponsiveGrid>
    </div>
  );
}
