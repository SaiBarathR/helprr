import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

// jsdom does no layout, so the toolbar's 44px tap area is checked as numbers
// from the CSS as written: the item's height, how far its ::after reaches, and
// the room above (the separator's margin) and below (the row's and the menu's
// padding), so the area stays inside the scrolling menu box.
const css = readFileSync('src/app/globals.css', 'utf8');
const source = readFileSync('src/components/ui/quick-context-menu.tsx', 'utf8');
const rem = (v: string) => (v.endsWith('rem') ? parseFloat(v) * 16 : parseFloat(v));

function coarse(selector: string, prop: string): number {
  const media = css.indexOf('@media (pointer: coarse) {', css.indexOf("[data-slot='context-menu-content'] {") - 200);
  const at = css.indexOf(`${selector} {`, media);
  const body = css.slice(at, css.indexOf('}', at));
  const m = new RegExp(`\\n\\s*${prop}:\\s*([\\d.]+(?:rem|px))`).exec(body);
  expect(m, `${selector} ${prop}`).not.toBeNull();
  return rem(m![1]);
}

describe('long-press menu toolbar tap area (touch)', () => {
  const reach = 4; // after:-inset-y-1
  it('reaches 4px above and below the item', () => {
    expect(source).toContain("after:absolute after:inset-x-0 after:-inset-y-1 after:content-['']");
  });

  it('is at least 44px tall', () => {
    const item = coarse("[data-slot='context-menu-content'] [data-context-toolbar] [data-slot='context-menu-item']", 'min-height');
    expect(item + 2 * reach).toBeGreaterThanOrEqual(44);
  });

  it('stays inside the menu box: the separator margin above, the row and menu padding below', () => {
    const separator = coarse("[data-slot='context-menu-separator']", 'margin-block');
    const row = coarse("[data-slot='context-menu-content'] [data-context-toolbar]", 'padding-bottom');
    const menu = coarse("[data-slot='context-menu-content']", 'padding');
    expect(separator).toBeGreaterThanOrEqual(reach);
    expect(row + menu).toBeGreaterThanOrEqual(reach);
  });
});
