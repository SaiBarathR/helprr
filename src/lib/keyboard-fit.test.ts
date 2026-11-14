// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrowRoomNeeded, FOCUS_SETTLE_MS, followKeyboard, formRoomTooShort, revealFocusedField } from './keyboard-fit';

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

  it('looks past a field hidden by CSS to the one the arrows go to next', () => {
    // Field 3's centre starts at 304, just below the box; field 2 is display:none (a
    // collapsed part), so ⌄ from field 1 goes to field 3 and it must come into view.
    const { node, box, fields, inView, shown } = form(4, { pitch: 88 });
    vi.spyOn(fields[1], 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 0 } as DOMRect);
    focus(node, fields[0]);
    expect(box.scrollTop).toBe(8);
    expect(shown(fields[0])).toBe(true);
    expect(inView(fields[2])).toBe(true);
  });

  it('moves nothing for a neighbour when focus is not on a field', () => {
    // The first field's centre sits at 310, just below the box: a focus on a
    // button must not pull the box towards it.
    const { node, box, fields } = form(4, { firstTop: 292 });
    const button = document.createElement('button');
    fields[3].after(button);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 150, bottom: 180 } as DOMRect);
    button.focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(0);
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

// Change password's three 44 px fields: New has a hint line under it.
const CHANGE_PASSWORD = [
  { top: 0, bottom: 44 },
  { top: 80, bottom: 124 },
  { top: 184, bottom: 228 },
];

describe('arrowRoomNeeded', () => {
  it('is a field and the centres of the fields either side, 4 px inside, for the field needing most', () => {
    // On New: Current's centre (22) to Confirm's (206), 4 px inside each.
    expect(arrowRoomNeeded(CHANGE_PASSWORD)).toBe(192);
    // A field at either end has one neighbour: on Confirm, New's centre (102) down to 228.
    expect(arrowRoomNeeded(CHANGE_PASSWORD.slice(1))).toBe(130);
  });

  it('is the field itself when it has no neighbour', () => {
    expect(arrowRoomNeeded([{ top: 10, bottom: 54 }])).toBe(44);
    expect(arrowRoomNeeded([])).toBe(0);
  });

  it('is a field taller than that pair', () => {
    expect(arrowRoomNeeded([{ top: 0, bottom: 44 }, { top: 60, bottom: 260 }])).toBe(260 - 18);
    expect(arrowRoomNeeded([{ top: 0, bottom: 300 }, { top: 316, bottom: 360 }])).toBe(342);
  });
});

describe('formRoomTooShort', () => {
  // A drawer-scroll box holding a header, the form's scrolling body and the
  // buttons. Pinned: the box fits (`overflow` 0) and the body is `room` tall.
  // Scrolling together: the body is its full height and the box overflows.
  function sheet({ bodyHeight, overflow, fields = CHANGE_PASSWORD }: { bodyHeight: number; overflow: number; fields?: typeof CHANGE_PASSWORD }) {
    const scroll = document.createElement('div');
    const body = document.createElement('div');
    body.style.overflowY = 'auto';
    scroll.appendChild(body);
    document.body.appendChild(scroll);
    Object.defineProperty(body, 'clientHeight', { value: bodyHeight, configurable: true });
    Object.defineProperty(scroll, 'clientHeight', { value: 300, configurable: true });
    Object.defineProperty(scroll, 'scrollHeight', { value: 300 + overflow, configurable: true });
    // The password manager's hidden username comes first; the arrows skip it.
    const username = document.createElement('input');
    username.hidden = true;
    body.appendChild(username);
    for (const rect of fields) {
      const field = document.createElement('input');
      // Scrolled anywhere: only the distances between fields count.
      vi.spyOn(field, 'getBoundingClientRect').mockReturnValue({ top: rect.top - 500, bottom: rect.bottom - 500 } as DOMRect);
      body.appendChild(field);
    }
    return scroll;
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('is short on an iPhone SE in the Home Screen app: 84 px between the pinned header and buttons', () => {
    expect(formRoomTooShort(sheet({ bodyHeight: 84, overflow: 0 }))).toBe(true);
  });

  it('has room on a bigger iPhone, which keeps its pinned buttons', () => {
    expect(formRoomTooShort(sheet({ bodyHeight: 247, overflow: 0 }))).toBe(false);
    // Exactly enough is enough.
    expect(formRoomTooShort(sheet({ bodyHeight: 192, overflow: 0 }))).toBe(false);
    expect(formRoomTooShort(sheet({ bodyHeight: 191, overflow: 0 }))).toBe(true);
  });

  it('gives the same answer once the header and buttons scroll with the fields, so it does not flip back', () => {
    // SE: the body's full 244 px, of which pinning would take 160.
    expect(formRoomTooShort(sheet({ bodyHeight: 244, overflow: 160 }))).toBe(true);
    // A form that fits whole has nothing to scroll.
    expect(formRoomTooShort(sheet({ bodyHeight: 244, overflow: 0 }))).toBe(false);
  });

  // keepIosFromScrolling lifts a newly focused field 2000 px for a frame.
  it('gives no answer while a field is lifted by an inline transform, then measures again', () => {
    const scroll = sheet({ bodyHeight: 247, overflow: 0 });
    const field = scroll.querySelectorAll('input')[2];
    field.style.transform = 'translateY(-2000px)';
    vi.mocked(field.getBoundingClientRect).mockReturnValue({ top: -2316, bottom: -2272 } as DOMRect);
    expect(formRoomTooShort(scroll)).toBeUndefined();
    field.style.transform = '';
    vi.mocked(field.getBoundingClientRect).mockReturnValue({ top: -316, bottom: -272 } as DOMRect);
    expect(formRoomTooShort(scroll)).toBe(false);
  });

  it('is never short for a step without fields to move between', () => {
    expect(formRoomTooShort(sheet({ bodyHeight: 10, overflow: 0, fields: [] }))).toBe(false);
  });

  it('is never short for a form whose fields are not in a scrolling body', () => {
    const scroll = sheet({ bodyHeight: 10, overflow: 0 });
    (scroll.firstElementChild as HTMLElement).style.overflowY = 'visible';
    expect(formRoomTooShort(scroll)).toBe(false);
  });
});

describe('revealFocusedField on the form\'s last field', () => {
  // A form scrolling as one column: fields 80 px apart from 110, then its
  // Turn on button 60 px under the last one, all in a box showing 100–300.
  function sheetForm(count: number, { buttonGap = 60, pinnedButton = false } = {}) {
    const node = document.createElement('div');
    const form = document.createElement('form');
    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    form.appendChild(box);
    node.appendChild(form);
    document.body.appendChild(node);
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
    const at = (el: HTMLElement, top: number, height: number) =>
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
        const t = top - box.scrollTop;
        return { top: t, bottom: t + height } as DOMRect;
      });
    const fields = Array.from({ length: count }, (_, i) => {
      const field = document.createElement('input');
      box.appendChild(field);
      at(field, 110 + i * 80, 36);
      return field;
    });
    const button = document.createElement('button');
    button.type = 'submit';
    (pinnedButton ? form : box).appendChild(button);
    const buttonTop = 110 + (count - 1) * 80 + 36 + buttonGap;
    if (pinnedButton) vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 320, bottom: 364 } as DOMRect);
    else at(button, buttonTop, 44);
    return { node, box, fields, button };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('also shows the button that sends the form, whole, when it fits', () => {
    // Two-step's code step: key, code (190–226), then Turn on at 276–320, under the box.
    const { node, box, fields, button } = sheetForm(2, { buttonGap: 50 });
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(20);
    // The key field's centre stays in view too.
    expect(fields[0].getBoundingClientRect().top + 18).toBeGreaterThanOrEqual(104);
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(300);
    expect(fields[1].getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
  });

  it('puts the button before the field above when both do not fit', () => {
    // Field 2 (190–226), then the button at 326–370: the button needs 70 px of
    // scroll, which leaves field 1's centre (128 - 70) above the box.
    const { node, box, fields } = sheetForm(2, { buttonGap: 100 });
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(70);
  });

  it('keeps the field in view rather than a button that does not fit with it', () => {
    // The button 400 px under the field: the field wins, nothing moves.
    const { node, box, fields } = sheetForm(2, { buttonGap: 400 });
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(0);
  });

  it('leaves a pinned button (outside the box) and fields that are not last alone', () => {
    const pinned = sheetForm(2, { buttonGap: 140, pinnedButton: true });
    pinned.fields[1].focus();
    revealFocusedField(pinned.node);
    expect(pinned.box.scrollTop).toBe(0);
    document.body.replaceChildren();
    const { node, box, fields } = sheetForm(3, { buttonGap: 140 });
    fields[0].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(0);
  });
});

describe('followKeyboard after focus moves with the keyboard up', () => {
  // iOS scrolls the visual viewport towards a newly focused field for a frame
  // or three (offsetTop 26 or 123, height unchanged) and back.
  function setUp() {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    const listeners = new Map<string, Set<() => void>>();
    const viewport = {
      height: window.innerHeight - 300,
      offsetTop: 0,
      scale: 1,
      addEventListener: (type: string, listener: () => void) => {
        if (!listeners.has(type)) listeners.set(type, new Set());
        listeners.get(type)!.add(listener);
      },
      removeEventListener: (type: string, listener: () => void) => listeners.get(type)?.delete(listener),
    };
    vi.stubGlobal('visualViewport', viewport);
    const fire = (type: 'scroll' | 'resize') => {
      listeners.get(type)?.forEach((listener) => listener());
      vi.advanceTimersToNextFrame();
    };
    const node = document.createElement('div');
    const fields = [document.createElement('input'), document.createElement('input')];
    node.append(...fields);
    document.body.appendChild(node);
    const place = vi.fn();
    const stop = followKeyboard(node, place);
    const placedAt = () => place.mock.calls.map(([covered]) => covered);
    return { viewport, fire, fields, place, placedAt, stop };
  }

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    document.body.replaceChildren();
  });

  it('keeps the sheet where it is while iOS scrolls towards the field and back', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    expect(placedAt()).toEqual([300]);
    fields[1].focus();
    viewport.offsetTop = 123;
    fire('scroll');
    viewport.offsetTop = 0;
    fire('scroll');
    vi.advanceTimersByTime(FOCUS_SETTLE_MS + 20);
    // Never placed 123 px lower.
    expect(placedAt().every((covered) => covered === 300)).toBe(true);
    stop();
  });

  it('follows a move that is still there once the focus has settled', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    fields[1].focus();
    viewport.offsetTop = 26;
    fire('scroll');
    expect(placedAt()).not.toContain(274);
    vi.advanceTimersByTime(FOCUS_SETTLE_MS);
    vi.advanceTimersToNextFrame();
    expect(placedAt().at(-1)).toBe(274);
    stop();
  });

  it('follows a pan at once when no field has just taken focus (#677: autocorrect, iOS showing a field)', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    fields[1].focus();
    vi.advanceTimersByTime(FOCUS_SETTLE_MS + 1);
    viewport.offsetTop = 40;
    fire('scroll');
    expect(placedAt().at(-1)).toBe(260);
    stop();
  });

  it('follows the keyboard changing size at once, even right after a focus', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    fields[1].focus();
    viewport.height -= 44;
    fire('resize');
    expect(placedAt().at(-1)).toBe(344);
    stop();
  });

  it('places nothing after it is stopped', () => {
    const { viewport, fire, fields, place, stop } = setUp();
    fields[1].focus();
    viewport.offsetTop = 26;
    fire('scroll');
    stop();
    const calls = place.mock.calls.length;
    vi.advanceTimersByTime(FOCUS_SETTLE_MS * 2);
    expect(place.mock.calls.length).toBe(calls);
  });
});
