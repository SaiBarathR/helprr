import type { ColSpan, RowSpan, WidgetInstance } from '@/lib/widgets/types';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import type { DiscoverLayoutConfig } from '@/lib/discover-layout-config';

export const DASHBOARD_DESKTOP_COLS = 12;
export const DASHBOARD_MOBILE_COLS = 4;

export function clampColSpan(value: unknown, fallback: ColSpan): ColSpan {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(DASHBOARD_DESKTOP_COLS, Math.round(n)));
}

export function clampRowSpan(value: unknown, fallback: RowSpan): RowSpan {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.round(n));
}

export function clampMobileColSpan(value: unknown, fallback: ColSpan): ColSpan {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(DASHBOARD_MOBILE_COLS, Math.round(n)));
}

export function isValidGridCoord(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 0;
}

function rectFits(
  occupancy: boolean[][],
  x: number,
  y: number,
  colSpan: number,
  rowSpan: number,
  cols: number,
): boolean {
  if (x < 0 || y < 0 || x + colSpan > cols) return false;
  for (let row = y; row < y + rowSpan; row += 1) {
    for (let col = x; col < x + colSpan; col += 1) {
      if (occupancy[row]?.[col]) return false;
    }
  }
  return true;
}

function markRect(
  occupancy: boolean[][],
  x: number,
  y: number,
  colSpan: number,
  rowSpan: number,
) {
  for (let row = y; row < y + rowSpan; row += 1) {
    occupancy[row] ??= [];
    for (let col = x; col < x + colSpan; col += 1) {
      occupancy[row][col] = true;
    }
  }
}

export function sanitizeSpansOnly(
  layout: WidgetInstance[],
  discoverLayout: DiscoverLayoutConfig | null,
): WidgetInstance[] {
  return layout
    .filter((item) => Boolean(getWidgetDefinition(item.widgetId, discoverLayout)))
    .map((item) => {
      const def = getWidgetDefinition(item.widgetId, discoverLayout)!;
      return {
        id: item.id,
        widgetId: item.widgetId,
        x: item.x,
        y: item.y,
        colSpan: clampColSpan(item.colSpan, def.defaultDesktopSpan.colSpan),
        rowSpan: clampRowSpan(item.rowSpan, def.defaultDesktopSpan.rowSpan),
        mobileColSpan: clampMobileColSpan(item.mobileColSpan, def.defaultMobileSpan.colSpan),
        mobileRowSpan: clampRowSpan(item.mobileRowSpan, def.defaultMobileSpan.rowSpan),
        mobileX: item.mobileX,
        mobileY: item.mobileY,
        layoutOverride: item.layoutOverride,
      };
    });
}

export function packSanitizedDesktop(layout: WidgetInstance[]): WidgetInstance[] {
  const occupancy: boolean[][] = [];
  return layout.map((item) => {
    for (let y = 0; ; y += 1) {
      for (let x = 0; x <= DASHBOARD_DESKTOP_COLS - item.colSpan; x += 1) {
        if (rectFits(occupancy, x, y, item.colSpan, item.rowSpan, DASHBOARD_DESKTOP_COLS)) {
          markRect(occupancy, x, y, item.colSpan, item.rowSpan);
          return { ...item, x, y };
        }
      }
    }
  });
}

export function packSanitizedMobile(layout: WidgetInstance[]): WidgetInstance[] {
  const occupancy: boolean[][] = [];
  return layout.map((item) => {
    const col = (item.mobileColSpan ?? 1) as number;
    const row = (item.mobileRowSpan ?? 1) as number;
    for (let y = 0; ; y += 1) {
      for (let x = 0; x <= DASHBOARD_MOBILE_COLS - col; x += 1) {
        if (rectFits(occupancy, x, y, col, row, DASHBOARD_MOBILE_COLS)) {
          markRect(occupancy, x, y, col, row);
          return { ...item, mobileX: x, mobileY: y };
        }
      }
    }
  });
}

export function packSanitizedLayout(layout: WidgetInstance[]): WidgetInstance[] {
  return packSanitizedMobile(packSanitizedDesktop(layout));
}

export function packLegacyLayout(
  layout: WidgetInstance[],
  discoverLayout: DiscoverLayoutConfig | null = null,
): WidgetInstance[] {
  return packSanitizedLayout(sanitizeSpansOnly(layout, discoverLayout));
}

export function placeWidgetInFirstGap(layout: WidgetInstance[], widget: WidgetInstance): WidgetInstance {
  const occupancy: boolean[][] = [];
  for (const item of layout) {
    if (!isValidGridCoord(item.x) || !isValidGridCoord(item.y)) continue;
    markRect(occupancy, item.x, item.y, item.colSpan, item.rowSpan);
  }
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= DASHBOARD_DESKTOP_COLS - widget.colSpan; x += 1) {
      if (rectFits(occupancy, x, y, widget.colSpan, widget.rowSpan, DASHBOARD_DESKTOP_COLS)) {
        return { ...widget, x, y };
      }
    }
  }
}

export function placeWidgetInFirstMobileGap(
  layout: WidgetInstance[],
  widget: WidgetInstance,
): WidgetInstance {
  const occupancy: boolean[][] = [];
  for (const item of layout) {
    if (!isValidGridCoord(item.mobileX) || !isValidGridCoord(item.mobileY)) continue;
    const col = (item.mobileColSpan ?? 1) as number;
    const row = (item.mobileRowSpan ?? 1) as number;
    markRect(occupancy, item.mobileX as number, item.mobileY as number, col, row);
  }
  const col = (widget.mobileColSpan ?? 1) as number;
  const row = (widget.mobileRowSpan ?? 1) as number;
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= DASHBOARD_MOBILE_COLS - col; x += 1) {
      if (rectFits(occupancy, x, y, col, row, DASHBOARD_MOBILE_COLS)) {
        return { ...widget, mobileX: x, mobileY: y };
      }
    }
  }
}

export function sanitizeDashboardLayout(
  layout: WidgetInstance[],
  discoverLayout: DiscoverLayoutConfig | null,
): WidgetInstance[] {
  const sanitized = sanitizeSpansOnly(layout, discoverLayout);

  let desktopValid = true;
  const desktopOccupancy: boolean[][] = [];
  for (const item of sanitized) {
    if (!isValidGridCoord(item.x) || !isValidGridCoord(item.y)) {
      desktopValid = false;
      break;
    }
    if ((item.x as number) + item.colSpan > DASHBOARD_DESKTOP_COLS) {
      desktopValid = false;
      break;
    }
    if (!rectFits(desktopOccupancy, item.x as number, item.y as number, item.colSpan, item.rowSpan, DASHBOARD_DESKTOP_COLS)) {
      desktopValid = false;
      break;
    }
    markRect(desktopOccupancy, item.x as number, item.y as number, item.colSpan, item.rowSpan);
  }
  const desktopPacked = desktopValid ? sanitized : packSanitizedDesktop(sanitized);

  let mobileValid = true;
  const mobileOccupancy: boolean[][] = [];
  for (const item of desktopPacked) {
    const col = (item.mobileColSpan ?? 1) as number;
    const row = (item.mobileRowSpan ?? 1) as number;
    if (!isValidGridCoord(item.mobileX) || !isValidGridCoord(item.mobileY)) {
      mobileValid = false;
      break;
    }
    if ((item.mobileX as number) + col > DASHBOARD_MOBILE_COLS) {
      mobileValid = false;
      break;
    }
    if (!rectFits(mobileOccupancy, item.mobileX as number, item.mobileY as number, col, row, DASHBOARD_MOBILE_COLS)) {
      mobileValid = false;
      break;
    }
    markRect(mobileOccupancy, item.mobileX as number, item.mobileY as number, col, row);
  }
  return mobileValid ? desktopPacked : packSanitizedMobile(desktopPacked);
}
