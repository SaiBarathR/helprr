import type { ColSpan, RowSpan, WidgetInstance, WidgetLayoutVariant } from '@/lib/widgets/types';
import { getWidgetDefinition } from '@/lib/widgets/registry';
import { WIDGET_REFRESH_MIN_SECS, WIDGET_REFRESH_MAX_SECS } from '@/lib/widgets/definitions';
import type { DiscoverLayoutConfig } from '@/lib/discover-layout-config';

const VALID_LAYOUT_VARIANTS: ReadonlySet<WidgetLayoutVariant> = new Set([
  'carousel',
  'list',
  'posters',
  'cards',
  'detailed',
  'vertical',
  'default',
]);

function sanitizeLayoutOverride(value: unknown): WidgetLayoutVariant | undefined {
  if (typeof value !== 'string') return undefined;
  return VALID_LAYOUT_VARIANTS.has(value as WidgetLayoutVariant)
    ? (value as WidgetLayoutVariant)
    : undefined;
}

function sanitizeRefreshInterval(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.floor(value);
  if (n < WIDGET_REFRESH_MIN_SECS || n > WIDGET_REFRESH_MAX_SECS) return undefined;
  return n;
}

export const DASHBOARD_DESKTOP_COLS = 12;
export const DASHBOARD_MOBILE_COLS = 4;
// Caps rowSpan so a crafted payload can't push markRect/packing helpers into
// pathological loops.
export const MAX_ROW_SPAN = 100;

export function clampColSpan(value: unknown, fallback: ColSpan): ColSpan {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.min(DASHBOARD_DESKTOP_COLS, Math.round(n)));
}

export function clampRowSpan(value: unknown, fallback: RowSpan): RowSpan {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(MAX_ROW_SPAN, Math.max(1, Math.round(n)));
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
        layoutOverride: sanitizeLayoutOverride(item.layoutOverride),
        mobileLayoutOverride: sanitizeLayoutOverride(item.mobileLayoutOverride),
        refreshIntervalSecs: sanitizeRefreshInterval(item.refreshIntervalSecs),
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
  // Belt-and-braces: a malformed widget wider than the grid would loop forever
  // because no row can ever fit it. Place at origin and let downstream
  // sanitization clamp the span instead.
  if (widget.colSpan > DASHBOARD_DESKTOP_COLS || widget.colSpan < 1) {
    return { ...widget, x: 0, y: 0 };
  }
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
  const col = (widget.mobileColSpan ?? 1) as number;
  const row = (widget.mobileRowSpan ?? 1) as number;
  if (col > DASHBOARD_MOBILE_COLS || col < 1) {
    return { ...widget, mobileX: 0, mobileY: 0 };
  }
  const occupancy: boolean[][] = [];
  for (const item of layout) {
    if (!isValidGridCoord(item.mobileX) || !isValidGridCoord(item.mobileY)) continue;
    const c = (item.mobileColSpan ?? 1) as number;
    const r = (item.mobileRowSpan ?? 1) as number;
    markRect(occupancy, item.mobileX as number, item.mobileY as number, c, r);
  }
  for (let y = 0; ; y += 1) {
    for (let x = 0; x <= DASHBOARD_MOBILE_COLS - col; x += 1) {
      if (rectFits(occupancy, x, y, col, row, DASHBOARD_MOBILE_COLS)) {
        return { ...widget, mobileX: x, mobileY: y };
      }
    }
  }
}

/**
 * Place each desktop-invalid widget into the first free gap WITHOUT disturbing
 * widgets that already have valid placements. Critical for edits made on one
 * viewport that omit the other viewport's coords for a newly-added widget —
 * the previous all-or-nothing repack would silently re-shuffle the whole grid.
 */
function partialPackDesktop(layout: WidgetInstance[]): WidgetInstance[] {
  const occupancy: boolean[][] = [];
  const invalidIdx = new Set<number>();
  for (let i = 0; i < layout.length; i += 1) {
    const item = layout[i];
    if (
      !isValidGridCoord(item.x)
      || !isValidGridCoord(item.y)
      || (item.x as number) + item.colSpan > DASHBOARD_DESKTOP_COLS
      || !rectFits(occupancy, item.x as number, item.y as number, item.colSpan, item.rowSpan, DASHBOARD_DESKTOP_COLS)
    ) {
      invalidIdx.add(i);
      continue;
    }
    markRect(occupancy, item.x as number, item.y as number, item.colSpan, item.rowSpan);
  }
  if (invalidIdx.size === 0) return layout;
  return layout.map((item, i) => {
    if (!invalidIdx.has(i)) return item;
    if (item.colSpan > DASHBOARD_DESKTOP_COLS || item.colSpan < 1) {
      return { ...item, x: 0, y: 0 };
    }
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

function partialPackMobile(layout: WidgetInstance[]): WidgetInstance[] {
  const occupancy: boolean[][] = [];
  const invalidIdx = new Set<number>();
  for (let i = 0; i < layout.length; i += 1) {
    const item = layout[i];
    const col = (item.mobileColSpan ?? 1) as number;
    const row = (item.mobileRowSpan ?? 1) as number;
    if (
      !isValidGridCoord(item.mobileX)
      || !isValidGridCoord(item.mobileY)
      || (item.mobileX as number) + col > DASHBOARD_MOBILE_COLS
      || !rectFits(occupancy, item.mobileX as number, item.mobileY as number, col, row, DASHBOARD_MOBILE_COLS)
    ) {
      invalidIdx.add(i);
      continue;
    }
    markRect(occupancy, item.mobileX as number, item.mobileY as number, col, row);
  }
  if (invalidIdx.size === 0) return layout;
  return layout.map((item, i) => {
    if (!invalidIdx.has(i)) return item;
    const col = (item.mobileColSpan ?? 1) as number;
    const row = (item.mobileRowSpan ?? 1) as number;
    if (col > DASHBOARD_MOBILE_COLS || col < 1) {
      return { ...item, mobileX: 0, mobileY: 0 };
    }
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

export function sanitizeDashboardLayout(
  layout: WidgetInstance[],
  discoverLayout: DiscoverLayoutConfig | null,
): WidgetInstance[] {
  const sanitized = sanitizeSpansOnly(layout, discoverLayout);
  return partialPackMobile(partialPackDesktop(sanitized));
}
