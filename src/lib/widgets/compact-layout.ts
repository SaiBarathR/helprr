import { verticalCompactor } from 'react-grid-layout/core';

export interface GridRect {
  i: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Pack the widgets this viewer can see upward, exactly as the edit grid
 * (react-grid-layout's default vertical compaction) does. A layout keeps the
 * rows of widgets a viewer can't see (a member without their capability), and
 * placed by their saved rows those would render as empty space. Display only:
 * the stored layout keeps its saved positions until someone edits it.
 */
export function compactGridRects(rects: GridRect[], cols: number): Map<string, { x: number; y: number }> {
  const packed = verticalCompactor.compact(
    rects.map(({ i, x, y, w, h }) => ({ i, x: Math.max(0, Math.min(x, cols - w)), y, w, h })),
    cols,
  );
  return new Map(packed.map((item) => [item.i, { x: item.x, y: item.y }]));
}

/** True when every rect in `next` sits where `shown` already places it. */
export function sameGridRects(next: readonly GridRect[], shown: readonly GridRect[]): boolean {
  if (next.length !== shown.length) return false;
  const byId = new Map(shown.map((rect) => [rect.i, rect]));
  return next.every((rect) => {
    const other = byId.get(rect.i);
    return !!other && other.x === rect.x && other.y === rect.y && other.w === rect.w && other.h === rect.h;
  });
}
