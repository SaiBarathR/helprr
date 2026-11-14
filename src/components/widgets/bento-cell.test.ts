import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { REMOVE_BUTTON } from './bento-cell';

// jsdom does no layout, so the edit chrome's geometry is checked as numbers:
// the resize grip's size and insets come from globals.css as written, the grid
// gaps from the grids' `margin` props (mobile 8px, desktop 10px).
const css = readFileSync('src/app/globals.css', 'utf8');
const source = readFileSync('src/components/widgets/bento-cell.tsx', 'utf8');

function rule(selector: string): Record<string, number> {
  const at = css.indexOf(`${selector} {`);
  expect(at, selector).toBeGreaterThan(-1);
  const body = css.slice(at, css.indexOf('}', at));
  const px = (prop: string) => { const m = new RegExp(`\\n\\s*${prop}:\\s*(\\d+)px`).exec(body); return m ? Number(m[1]) : NaN; };
  return { width: px('width'), height: px('height'), right: px('right'), bottom: px('bottom') };
}

const GRIP = '.dashboard-bento-grid-rgl .react-grid-item > .react-resizable-handle';
const MOBILE_GRIP = '.dashboard-bento-grid-rgl-mobile .react-grid-item > .react-resizable-handle';
const desktopGrip = rule(GRIP);
const desktopChevron = rule(`${GRIP}::after`);
const mobileGrip = { ...desktopGrip, ...rule(MOBILE_GRIP) };
const mobileChevron = { ...desktopChevron, ...rule(`${MOBILE_GRIP}::after`) };

/** Whether a point (px from this card's top-left corner) takes taps for the remove button. */
function hitsRemove(x: number, y: number) {
  const { offset, size, hitArea } = REMOVE_BUTTON;
  // The round button, centred on the corner (hit-testing follows border-radius)...
  const r = size / 2;
  const inButton = (x - (r - offset)) ** 2 + (y - (r - offset)) ** 2 <= r ** 2;
  // ...and its tap area, which starts at the corner and grows into the card only.
  const inArea = x >= 0 && y >= 0 && x <= hitArea && y <= hitArea;
  return inButton || inArea;
}

describe('edit mode remove button', () => {
  it('draws the tap area from the corner into the card, the size REMOVE_BUTTON says', () => {
    expect(source).toContain(`after:top-[${REMOVE_BUTTON.offset}px] after:left-[${REMOVE_BUTTON.offset}px] after:size-11`);
    expect(REMOVE_BUTTON.hitArea).toBe(44); // size-11
    expect(REMOVE_BUTTON.offset).toBe(REMOVE_BUTTON.size / 2);
  });

  it.each([
    ['phone', 8, mobileGrip, mobileChevron],
    ['desktop', 10, desktopGrip, desktopChevron],
  ] as const)('leaves the resize grip of the tile up and to the left to that grip (%s)', (_name, gap, grip, chevron) => {
    expect([grip.width, grip.right, chevron.width, chevron.right].every(Number.isFinite)).toBe(true);
    // That tile's bottom-right corner sits at (-gap, -gap) from this card's corner.
    const gripRight = -gap - grip.right;
    const gripBottom = -gap - grip.bottom;
    const centre = [gripRight - grip.width / 2, gripBottom - grip.height / 2] as const;
    const chevronRight = gripRight - chevron.right;
    const chevronBottom = gripBottom - chevron.bottom;
    const chevronPoints = [
      [chevronRight, chevronBottom], [chevronRight - chevron.width, chevronBottom], [chevronRight, chevronBottom - chevron.height],
    ] as const;
    expect(hitsRemove(...centre)).toBe(false);
    for (const p of chevronPoints) expect(hitsRemove(...p)).toBe(false);
    // Nor any point of the grip at all.
    for (let x = gripRight - grip.width; x <= gripRight; x++) {
      for (let y = gripBottom - grip.height; y <= gripBottom; y++) expect(hitsRemove(x, y)).toBe(false);
    }
  });

  it('keeps a 44px square to tap inside its own card', () => {
    expect(hitsRemove(1, 1)).toBe(true);
    expect(hitsRemove(43, 43)).toBe(true);
    expect(hitsRemove(-10, -10)).toBe(false); // outside the round button's corner
    expect(hitsRemove(-5, -5)).toBe(true);
  });
});
