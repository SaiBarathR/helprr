// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { revealFocusedField } from './keyboard-fit';

// A scroll box showing 100–300 px of a column of 36 px fields, 80 px apart,
// laid out as if scrolled by `box.scrollTop`. iOS's ⌃ / ⌄ arrows skip a field
// whose centre is outside that box.
function form(count: number, { firstTop = 110, pitch = 80, height = 36 } = {}) {
  const node = document.createElement('div');
  const box = document.createElement('div');
  box.style.overflowY = 'auto';
  node.appendChild(box);
  document.body.appendChild(node);
  Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
  Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
  vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
  const fields = Array.from({ length: count }, (_, i) => {
    const field = document.createElement('input');
    box.appendChild(field);
    vi.spyOn(field, 'getBoundingClientRect').mockImplementation(() => {
      const top = firstTop + i * pitch - box.scrollTop;
      return { top, bottom: top + height } as DOMRect;
    });
    return field;
  });
  const centre = (field: HTMLElement) => {
    const rect = field.getBoundingClientRect();
    return (rect.top + rect.bottom) / 2;
  };
  const inView = (field: HTMLElement) => centre(field) > 100 && centre(field) < 300;
  const shown = (field: HTMLElement) => field.getBoundingClientRect().top >= 100 && field.getBoundingClientRect().bottom <= 300;
  return { node, box, fields, inView, shown };
}

function focus(node: HTMLElement, field: HTMLElement) {
  field.focus();
  revealFocusedField(node);
}

describe('revealFocusedField', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('scrolls nothing when the field and its neighbours are already in view', () => {
    const { node, box, fields } = form(3);
    focus(node, fields[1]);
    expect(box.scrollTop).toBe(0);
  });

  it('going down (⌄), keeps the field before in view as well as the one after', () => {
    const { node, box, fields, inView, shown } = form(5);
    for (const [at, field] of fields.entries()) {
      focus(node, field);
      expect(shown(field)).toBe(true);
      if (at > 0) expect(inView(fields[at - 1])).toBe(true);
      if (at < fields.length - 1) expect(inView(fields[at + 1])).toBe(true);
    }
    expect(box.scrollTop).toBeGreaterThan(0);
  });

  it('going up (⌃), keeps the field after in view as well as the one before', () => {
    const { node, box, fields, inView, shown } = form(5);
    box.scrollTop = 400;
    for (let at = fields.length - 1; at >= 0; at--) {
      focus(node, fields[at]);
      expect(shown(fields[at])).toBe(true);
      if (at > 0) expect(inView(fields[at - 1])).toBe(true);
      if (at < fields.length - 1) expect(inView(fields[at + 1])).toBe(true);
    }
  });

  it('scrolls only as far as it has to, never putting the field at the top', () => {
    const { node, box, fields } = form(4);
    // Field 4's centre is at 368; it must come up to 296 (4 px inside the bottom).
    focus(node, fields[2]);
    expect(box.scrollTop).toBe(72);
    expect(fields[2].getBoundingClientRect().top).toBeGreaterThan(100 + 40);
  });

  it('keeps the next field when both neighbours do not fit', () => {
    const { node, fields, inView, shown } = form(3, { pitch: 110 });
    focus(node, fields[1]);
    expect(shown(fields[1])).toBe(true);
    expect(inView(fields[2])).toBe(true);
    expect(inView(fields[0])).toBe(false);
  });

  it('shows the top of a field taller than the box', () => {
    const { node, box, fields } = form(1, { firstTop: 400, height: 300 });
    focus(node, fields[0]);
    expect(box.scrollTop).toBe(300);
  });

  it('skips fields the arrows do not go to: hidden or disabled', () => {
    const { node, box, fields } = form(3, { pitch: 100 });
    // Field 3 would need a scroll; hidden (the password manager's username) or disabled, it is no stop.
    fields[2].hidden = true;
    focus(node, fields[1]);
    expect(box.scrollTop).toBe(0);
    fields[2].hidden = false;
    fields[2].disabled = true;
    focus(node, fields[1]);
    expect(box.scrollTop).toBe(0);
  });
});
