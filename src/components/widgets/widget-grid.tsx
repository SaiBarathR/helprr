'use client';

import { lazy, Suspense, useMemo, type CSSProperties } from 'react';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import type { WidgetInstance } from '@/lib/widgets/types';
import { useUIStore } from '@/lib/store';
import { useDashboardLayout } from './dashboard-layout-context';
import { useVisibleDashboardWidgets, WidgetGridItem } from './widget-grid-shared';

interface WidgetGridProps {
  isMobile: boolean;
  onConfigureRefresh: () => void;
}

const MOBILE_COLS = 4;
const DESKTOP_COLS = 12;
const MOBILE_ROW_HEIGHT = 84;
const DESKTOP_ROW_HEIGHT = 90;
const MOBILE_GAP = 8;
const DESKTOP_GAP = 10;

const LazyWidgetGridDesktop = lazy(() =>
  import('./widget-grid-desktop').then((module) => ({ default: module.WidgetGridDesktop })),
);
const LazyWidgetGridMobile = lazy(() =>
  import('./widget-grid-mobile').then((module) => ({ default: module.WidgetGridMobile })),
);

function getStaticLayout(instance: WidgetInstance, isMobile: boolean, discoverLayout: ReturnType<typeof useUIStore.getState>['discoverLayout']) {
  if (!isMobile) {
    return {
      x: Math.max(0, instance.x ?? 0),
      y: Math.max(0, instance.y ?? 0),
      col: Math.min(DESKTOP_COLS, Math.max(1, instance.colSpan)),
      row: Math.max(1, instance.rowSpan),
      narrow: false,
    };
  }
  const def = getWidgetDefinition(instance.widgetId, discoverLayout);
  const col = Math.min(
    MOBILE_COLS,
    Math.max(1, (instance.mobileColSpan ?? def?.defaultMobileSpan.colSpan ?? 2) as number),
  );
  return {
    x: Math.max(0, Math.min(MOBILE_COLS - 1, instance.mobileX ?? 0)),
    y: Math.max(0, instance.mobileY ?? 0),
    col,
    row: Math.max(1, (instance.mobileRowSpan ?? def?.defaultMobileSpan.rowSpan ?? 1) as number),
    narrow: col <= 2,
  };
}

function StaticWidgetGrid({ isMobile, onConfigureRefresh }: WidgetGridProps) {
  const { widgets: dashboardLayout, removeWidget } = useDashboardLayout();
  const discoverLayout = useUIStore((s) => s.discoverLayout);
  const visibleWidgets = useVisibleDashboardWidgets(dashboardLayout);
  const layouts = useMemo(
    () => new Map(visibleWidgets.map((instance) => [
      instance.id,
      getStaticLayout(instance, isMobile, discoverLayout),
    ])),
    [visibleWidgets, isMobile, discoverLayout],
  );
  const cols = isMobile ? MOBILE_COLS : DESKTOP_COLS;
  const rowHeight = isMobile ? MOBILE_ROW_HEIGHT : DESKTOP_ROW_HEIGHT;
  const gap = isMobile ? MOBILE_GAP : DESKTOP_GAP;

  return (
    <div
      className="dashboard-bento-grid"
      style={{
        ['--hpr-cols' as string]: String(cols),
        ['--hpr-gap' as string]: `${gap}px`,
        gridAutoRows: `${rowHeight}px`,
      } as CSSProperties}
    >
      {visibleWidgets.map((instance) => {
        const layout = layouts.get(instance.id);
        if (!layout) return null;
        const x = Math.min(layout.x, Math.max(0, cols - layout.col));
        return (
          <div
            key={instance.id}
            data-widget-id={instance.id}
            style={{
              gridColumn: `${x + 1} / span ${layout.col}`,
              gridRow: `${layout.y + 1} / span ${layout.row}`,
              minWidth: 0,
              minHeight: 0,
            }}
          >
            <WidgetGridItem
              instance={instance}
              editMode={false}
              onRemove={removeWidget}
              colSpan={layout.col}
              rowSpan={layout.row}
              narrow={layout.narrow}
              mobileGrid={isMobile}
              onConfigureRefresh={onConfigureRefresh}
            />
          </div>
        );
      })}
    </div>
  );
}

export function WidgetGrid({ isMobile, onConfigureRefresh }: WidgetGridProps) {
  const editMode = useUIStore((s) => s.dashboardEditMode);
  if (!editMode) {
    return <StaticWidgetGrid isMobile={isMobile} onConfigureRefresh={onConfigureRefresh} />;
  }
  const Grid = isMobile ? LazyWidgetGridMobile : LazyWidgetGridDesktop;
  return (
    <Suspense fallback={<StaticWidgetGrid isMobile={isMobile} onConfigureRefresh={onConfigureRefresh} />}>
      <Grid onConfigureRefresh={onConfigureRefresh} />
    </Suspense>
  );
}
