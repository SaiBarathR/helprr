'use client';

import { useMemo, type CSSProperties } from 'react';
import GridLayout, { WidthProvider, type Layout } from 'react-grid-layout/legacy';
import 'react-grid-layout/css/styles.css';
import 'react-resizable/css/styles.css';
import { useUIStore } from '@/lib/store';
import type { ColSpan, RowSpan } from '@/lib/widgets/types';
import { useDashboardLayout } from './dashboard-layout-context';
import { ThemeInspector } from './theme-inspector';
import { useVisibleDashboardWidgets, WidgetGridItem } from './widget-grid-shared';

const ResponsiveGrid = WidthProvider(GridLayout);

export function WidgetGridDesktop({ onConfigureRefresh }: { onConfigureRefresh: () => void }) {
  const { widgets: dashboardLayout, removeWidget, updateWidgetPositions } = useDashboardLayout();
  const editMode = useUIStore((s) => s.dashboardEditMode);
  const visibleWidgets = useVisibleDashboardWidgets(dashboardLayout);

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
    <div style={{ ['--hpr-cols' as string]: '12' } as CSSProperties}>
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
