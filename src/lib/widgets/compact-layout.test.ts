import { describe, expect, it } from 'vitest';
import { compactGridRects, sameGridRects } from './compact-layout';

describe('compactGridRects', () => {
  it("closes the rows of widgets a viewer can't see", () => {
    // A member's phone layout: stats at row 0, their own widget saved at row 25
    // below ten default widgets they lack the capability for.
    const packed = compactGridRects([
      { i: 'stats', x: 0, y: 0, w: 4, h: 2 },
      { i: 'anime', x: 0, y: 25, w: 4, h: 3 },
    ], 4);
    expect(packed.get('stats')).toEqual({ x: 0, y: 0 });
    expect(packed.get('anime')).toEqual({ x: 0, y: 2 });
  });

  it('keeps side-by-side widgets in their columns and order', () => {
    const packed = compactGridRects([
      { i: 'a', x: 0, y: 4, w: 6, h: 2 },
      { i: 'b', x: 6, y: 5, w: 6, h: 3 },
      { i: 'c', x: 0, y: 9, w: 12, h: 1 },
    ], 12);
    expect(packed.get('a')).toEqual({ x: 0, y: 0 });
    expect(packed.get('b')).toEqual({ x: 6, y: 0 });
    // Below the taller of the two.
    expect(packed.get('c')).toEqual({ x: 0, y: 3 });
  });

  it('leaves an already packed layout as it is', () => {
    const rects = [
      { i: 'a', x: 0, y: 0, w: 2, h: 1 },
      { i: 'b', x: 2, y: 0, w: 2, h: 2 },
      { i: 'c', x: 0, y: 1, w: 2, h: 1 },
    ];
    const packed = compactGridRects(rects, 4);
    for (const rect of rects) expect(packed.get(rect.i)).toEqual({ x: rect.x, y: rect.y });
  });

  it('pulls a widget that would overflow the grid back inside it', () => {
    expect(compactGridRects([{ i: 'a', x: 3, y: 0, w: 2, h: 1 }], 4).get('a')).toEqual({ x: 2, y: 0 });
  });

  it('does not change the rects it is given', () => {
    const rects = [{ i: 'a', x: 0, y: 7, w: 4, h: 1 }];
    compactGridRects(rects, 4);
    expect(rects[0].y).toBe(7);
  });
});

describe('sameGridRects', () => {
  const shown = [{ i: 'a', x: 0, y: 0, w: 2, h: 1 }, { i: 'b', x: 2, y: 0, w: 2, h: 1 }];

  it('is true for the same placements in any order', () => {
    expect(sameGridRects([shown[1], shown[0]], shown)).toBe(true);
  });

  it('is false when a widget moved, resized or is missing', () => {
    expect(sameGridRects([shown[0], { ...shown[1], y: 1 }], shown)).toBe(false);
    expect(sameGridRects([shown[0], { ...shown[1], w: 1 }], shown)).toBe(false);
    expect(sameGridRects([shown[0]], shown)).toBe(false);
  });
});
