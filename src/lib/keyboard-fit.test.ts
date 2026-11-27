// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { arrowRoomNeeded, followKeyboard, followPageKeyboard, formRoomTooShort, opensKeyboard, PAN_HOLD_MS, PAN_STILL_MS, revealFocusedField, safariBarOverKeyboard } from './keyboard-fit';

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

  it('skips fields the arrows do not go to: hidden, disabled or out of the tab order', () => {
    const { node, box, fields } = form(3, { pitch: 100 });
    // Field 3 would need a scroll; hidden (the password manager's username) or disabled, it is no stop.
    fields[2].hidden = true;
    focus(node, fields[1]);
    expect(box.scrollTop).toBe(0);
    fields[2].hidden = false;
    fields[2].disabled = true;
    focus(node, fields[1]);
    expect(box.scrollTop).toBe(0);
    // Radix Select's hidden <select tabindex="-1"> in a form.
    fields[2].disabled = false;
    fields[2].tabIndex = -1;
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

describe('opensKeyboard', () => {
  const make = (html: string) => {
    const host = document.createElement('div');
    host.innerHTML = html;
    return host.firstElementChild;
  };

  it('is true for text fields, selects and editable text', () => {
    expect(opensKeyboard(make('<input type="password">'))).toBe(true);
    expect(opensKeyboard(make('<textarea></textarea>'))).toBe(true);
    expect(opensKeyboard(make('<select><option>a</option></select>'))).toBe(true);
    const editable = make('<div contenteditable="true"></div>')!;
    Object.defineProperty(editable, 'isContentEditable', { value: true });
    expect(opensKeyboard(editable)).toBe(true);
  });

  it('is false for buttons, links, checkboxes and no focus', () => {
    expect(opensKeyboard(make('<button>More</button>'))).toBe(false);
    expect(opensKeyboard(make('<a href="/settings">Settings</a>'))).toBe(false);
    expect(opensKeyboard(make('<input type="checkbox">'))).toBe(false);
    expect(opensKeyboard(document.body)).toBe(false);
    expect(opensKeyboard(null)).toBe(false);
  });
});

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

  // ⌃ needs the field above (#677): Change password's Confirm in a tight box.
  it('keeps the field above rather than the button when both do not fit', () => {
    // Field 2 (190–226), then the button at 326–370: the button needs 70 px of
    // scroll, which would leave field 1's centre (128 - 70) above the box.
    const { node, box, fields } = sheetForm(2, { buttonGap: 100 });
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(0);
    const centre = (fields[0].getBoundingClientRect().top + fields[0].getBoundingClientRect().bottom) / 2;
    expect(centre).toBeGreaterThanOrEqual(104);
  });

  // Two-step's code step: the field above is the read-only key, which iOS's arrows skip.
  it('does not count a read-only field above, so the button is shown', () => {
    const { node, box, fields } = sheetForm(2, { buttonGap: 100 });
    fields[0].readOnly = true;
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(70);
  });

  it('finds the form\'s default button: one with no type, or one joined by form="…"', () => {
    const { node, box, fields, button } = sheetForm(2, { buttonGap: 50 });
    button.removeAttribute('type');
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(20);
    // A button outside the <form>, joined to it by its id.
    box.scrollTop = 0;
    const form = node.querySelector('form')!;
    form.id = 'tf-form';
    form.after(box);
    button.setAttribute('form', 'tf-form');
    const typeButton = document.createElement('button');
    typeButton.type = 'button';
    box.prepend(typeButton);
    for (const f of fields) f.setAttribute('form', 'tf-form');
    // Moving it took the focus away.
    fields[1].focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(20);
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

describe('followKeyboard when only the visible part moves', () => {
  // iOS scrolls the visual viewport towards a newly focused field for a frame
  // or three (offsetTop 26 or 123, height unchanged) and back.
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)';

  function setUp(userAgent = iPhone) {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance'] });
    vi.stubGlobal('navigator', { ...navigator, userAgent });
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
    // An event, and the frame it schedules.
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

  it('keeps the sheet where it is while iOS scrolls towards a focused field and back', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    expect(placedAt()).toEqual([300]);
    fields[1].focus();
    viewport.offsetTop = 123;
    fire('scroll');
    fire('scroll');
    viewport.offsetTop = 0;
    fire('scroll');
    vi.advanceTimersByTime(PAN_HOLD_MS * 2);
    // Never placed 123 px lower.
    expect(placedAt().every((covered) => covered === 300)).toBe(true);
    stop();
  });

  it('follows a move that lasts within about four frames of it', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    fields[1].focus();
    viewport.offsetTop = 26;
    fire('scroll');
    vi.advanceTimersByTime(PAN_HOLD_MS - 20);
    expect(placedAt()).not.toContain(274);
    vi.advanceTimersByTime(20);
    vi.advanceTimersToNextFrame();
    expect(placedAt().at(-1)).toBe(274);
    stop();
  });

  it('times the hold from the move, so focus moving on and on does not delay a pan that lasts', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    // A field takes focus, then a pan starts and stays while focus keeps moving.
    fields[0].focus();
    vi.advanceTimersByTime(10);
    viewport.offsetTop = 40;
    fire('scroll');
    for (let i = 1; i <= 4; i++) {
      fields[i % 2].focus();
      vi.advanceTimersByTime(20);
    }
    vi.advanceTimersToNextFrame();
    // About 80 ms after the move, it is already followed.
    expect(placedAt().at(-1)).toBe(260);
    stop();
  });

  // A drag under the keyboard, or iOS's animated scroll to a hidden field.
  it('follows a pan that keeps going on every frame once it has lasted, and settles where it stops', () => {
    const { viewport, fire, placedAt, stop } = setUp();
    for (let i = 1; i <= 30; i++) {
      viewport.offsetTop = i * 4;
      fire('scroll');
    }
    const placements = placedAt().slice(1);
    // Held for its first ~70 ms (about 4 frames), then every frame.
    expect(placements.length).toBeGreaterThanOrEqual(25);
    const steps = placements.slice(1).map((covered, i) => placements[i] - covered);
    expect(Math.max(...steps)).toBeLessThanOrEqual(4);
    // Where it stopped, exactly, and nothing more once it is still.
    expect(placedAt().at(-1)).toBe(300 - 120);
    const calls = placedAt().length;
    vi.advanceTimersByTime(PAN_STILL_MS * 3);
    expect(placedAt().length).toBe(calls);
    stop();
  });

  it('holds the next brief scroll again once a pan has been still for a while', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp();
    for (let i = 1; i <= 10; i++) {
      viewport.offsetTop = i * 4;
      fire('scroll');
    }
    expect(placedAt().at(-1)).toBe(260);
    vi.advanceTimersByTime(PAN_STILL_MS + 20);
    fields[1].focus();
    viewport.offsetTop = 40 + 123;
    fire('scroll');
    viewport.offsetTop = 40;
    fire('scroll');
    expect(placedAt()).not.toContain(260 - 123);
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

  // The jitter is iOS's: Android Chrome and desktop follow every move at once.
  it('follows a move at once outside iOS', () => {
    const { viewport, fire, fields, placedAt, stop } = setUp('Mozilla/5.0 (Linux; Android 16; Pixel 9) Chrome/145.0 Mobile');
    fields[1].focus();
    viewport.offsetTop = 26;
    fire('scroll');
    expect(placedAt().at(-1)).toBe(274);
    stop();
  });

  it('places nothing after it is stopped', () => {
    const { viewport, fire, fields, place, stop } = setUp();
    fields[1].focus();
    viewport.offsetTop = 26;
    fire('scroll');
    stop();
    const calls = place.mock.calls.length;
    vi.advanceTimersByTime(PAN_HOLD_MS * 4);
    expect(place.mock.calls.length).toBe(calls);
  });
});

describe('opensKeyboard and read-only fields', () => {
  it('does not count a read-only input or textarea, but does an editable one and a select', async () => {
    const { opensKeyboard } = await import('./keyboard-fit');
    const input = document.createElement('input');
    expect(opensKeyboard(input)).toBe(true);
    input.readOnly = true;
    expect(opensKeyboard(input)).toBe(false);
    const area = document.createElement('textarea');
    area.readOnly = true;
    expect(opensKeyboard(area)).toBe(false);
    expect(opensKeyboard(document.createElement('select'))).toBe(true);
  });
});

describe('safariBarOverKeyboard', () => {
  afterEach(() => vi.unstubAllGlobals());
  const iPhone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)';
  const at = (userAgent: string, width: number, height: number, standalone = false) => {
    vi.stubGlobal('navigator', { ...navigator, userAgent, standalone });
    vi.stubGlobal('screen', { width, height });
    return safariBarOverKeyboard();
  };

  it('is true in a Safari tab on a Face ID iPhone, Display Zoom included', () => {
    expect(at(iPhone, 402, 874)).toBe(true);
    expect(at(iPhone, 375, 812)).toBe(true);
    // A zoomed 6.1-inch phone or mini reports a screen smaller than an SE's.
    expect(at(iPhone, 320, 693)).toBe(true);
  });

  it('is false on an iPhone with a Home button (16:9), zoomed or not, in either orientation', () => {
    expect(at(iPhone, 375, 667)).toBe(false);
    expect(at(iPhone, 667, 375)).toBe(false);
    expect(at(iPhone, 320, 568)).toBe(false);
    expect(at(iPhone, 414, 736)).toBe(false);
  });

  it('is unchanged on an iPad, and false in the Home Screen app and off iOS', () => {
    expect(at('Mozilla/5.0 (iPad; CPU OS 27_0 like Mac OS X)', 768, 1024)).toBe(true);
    expect(at(iPhone, 402, 874, true)).toBe(false);
    expect(at('Mozilla/5.0 (Linux; Android 16)', 412, 915)).toBe(false);
  });
});

describe('revealFocusedField in a short confirm step (data-keyboard-whole)', () => {
  // Backups' Restore step in the tab, a box showing 100–300: its heading, the
  // typed word, the password field, then Cancel / Restore.
  function step({ formTop = 110, scrollTop = 0 } = {}) {
    const node = document.createElement('div');
    const box = document.createElement('div');
    box.style.overflowY = 'auto';
    const form = document.createElement('form');
    form.setAttribute('data-keyboard-whole', '');
    box.appendChild(form);
    node.appendChild(box);
    document.body.appendChild(node);
    Object.defineProperty(box, 'clientHeight', { value: 200, configurable: true });
    Object.defineProperty(box, 'scrollHeight', { value: 1000, configurable: true });
    vi.spyOn(box, 'getBoundingClientRect').mockReturnValue({ top: 100, bottom: 300 } as DOMRect);
    const at = (el: HTMLElement, top: number, height: number) =>
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => {
        const t = top - box.scrollTop;
        return { top: t, bottom: t + height } as DOMRect;
      });
    at(form, formTop, 0);
    const word = document.createElement('input');
    const pwField = document.createElement('input');
    const button = document.createElement('button');
    button.type = 'submit';
    form.append(word, pwField, button);
    at(word, formTop + 10, 44);
    at(pwField, formTop + 90, 44);
    at(button, formTop + 150, 44);
    box.scrollTop = scrollTop;
    return { node, box, form, word, pwField, button };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  it('shows the password and the button while the typed word, not the last field, has focus', () => {
    // The button at 260–304 ends 4 px under the box.
    const { node, box, word, pwField, button } = step();
    word.focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(4);
    expect(button.getBoundingClientRect().bottom).toBeLessThanOrEqual(300);
    expect(pwField.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
    expect(word.getBoundingClientRect().top).toBeGreaterThanOrEqual(100);
  });

  it('brings its heading back into view when the whole step fits', () => {
    // Scrolled 40 past the step's top, with everything else in view.
    const { node, box, form, pwField } = step({ formTop: 120, scrollTop: 40 });
    pwField.focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(20);
    expect(form.getBoundingClientRect().top).toBe(100);
  });

  it('keeps the field and button rather than a heading that does not fit with them', () => {
    // The step is 60 + 194 tall from 50: its heading can't share the box with the button.
    const { node, box, word, pwField, button } = step({ formTop: 50, scrollTop: 0 });
    vi.mocked(word.getBoundingClientRect).mockImplementation(() => ({ top: 150 - box.scrollTop, bottom: 194 - box.scrollTop }) as DOMRect);
    vi.mocked(pwField.getBoundingClientRect).mockImplementation(() => ({ top: 230 - box.scrollTop, bottom: 274 - box.scrollTop }) as DOMRect);
    vi.mocked(button.getBoundingClientRect).mockImplementation(() => ({ top: 290 - box.scrollTop, bottom: 334 - box.scrollTop }) as DOMRect);
    pwField.focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(34);
  });

  it('is unchanged for a form not marked: the button waits for the last field', () => {
    const { node, box, form, word } = step();
    form.removeAttribute('data-keyboard-whole');
    word.focus();
    revealFocusedField(node);
    expect(box.scrollTop).toBe(0);
  });
});

describe('formRoomTooShort with a step kept whole', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.replaceChildren();
  });

  // Backups' Download step: heading, warning, password and button, 330 px from
  // its top to the button's foot, in a pinned body `bodyHeight` tall.
  function download(bodyHeight: number, marked = true) {
    const scroll = document.createElement('div');
    const body = document.createElement('div');
    body.style.overflowY = 'auto';
    const form = document.createElement('form');
    if (marked) form.setAttribute('data-keyboard-whole', '');
    body.appendChild(form);
    scroll.appendChild(body);
    document.body.appendChild(scroll);
    Object.defineProperty(body, 'clientHeight', { value: bodyHeight, configurable: true });
    Object.defineProperty(scroll, 'clientHeight', { value: 500, configurable: true });
    Object.defineProperty(scroll, 'scrollHeight', { value: 500, configurable: true });
    const pwField = document.createElement('input');
    const button = document.createElement('button');
    button.type = 'submit';
    form.append(pwField, button);
    vi.spyOn(form, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 338 } as DOMRect);
    vi.spyOn(pwField, 'getBoundingClientRect').mockReturnValue({ top: 226, bottom: 270 } as DOMRect);
    vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({ top: 286, bottom: 330 } as DOMRect);
    return scroll;
  }

  it('is short when the step, from its heading to its button, does not fit the pinned body', () => {
    expect(formRoomTooShort(download(300))).toBe(true);
    expect(formRoomTooShort(download(330))).toBe(false);
  });

  it('counts only the fields for a form not marked', () => {
    expect(formRoomTooShort(download(300, false))).toBe(false);
  });
});

describe('revealFocusedField on the page itself', () => {
  // A page whose visible part, with the keyboard up, is 0–400 of the layout
  // viewport; the page scrolls by window.scrollY.
  function page({ toolbar = false } = {}) {
    let scrolled = 0;
    vi.spyOn(window, 'scrollBy').mockImplementation(((_x: number, y: number) => { scrolled += y; }) as typeof window.scrollBy);
    vi.stubGlobal('visualViewport', { height: 400, offsetTop: 0, scale: 1 });
    // jsdom has none; a browser's is the root.
    Object.defineProperty(document, 'scrollingElement', { value: document.documentElement, configurable: true });
    const at = (el: HTMLElement, top: number, height: number) =>
      vi.spyOn(el, 'getBoundingClientRect').mockImplementation(() => ({ top: top - scrolled, bottom: top - scrolled + height }) as DOMRect);
    const bar = document.createElement('header');
    bar.className = 'page-toolbar';
    // Sticky: pinned at the top whatever the scroll.
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 44 } as DOMRect);
    const main = document.createElement('main');
    const form = document.createElement('form');
    const quality = document.createElement('input');
    const folder = document.createElement('input');
    const save = document.createElement('button');
    save.type = 'submit';
    form.append(quality, folder, save);
    main.append(form);
    if (toolbar) document.body.append(bar);
    document.body.append(main);
    at(quality, 200, 36);
    at(folder, 300, 36);
    at(save, 380, 44);
    return { main, folder, save, scrolled: () => scrolled };
  }

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(document, 'scrollingElement');
    document.body.replaceChildren();
  });

  it('leaves the page where it is for a search box in the sticky toolbar', () => {
    // The list was scrolled part way down; the toolbar stays pinned at 0–100.
    const { scrolled } = page();
    const toolbar = document.createElement('header');
    toolbar.className = 'page-toolbar';
    vi.spyOn(toolbar, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 100 } as DOMRect);
    const search = document.createElement('input');
    vi.spyOn(search, 'getBoundingClientRect').mockReturnValue({ top: 56, bottom: 92 } as DOMRect);
    toolbar.append(search);
    document.body.prepend(toolbar);
    search.focus();
    revealFocusedField(document.documentElement);
    expect(scrolled()).toBe(0);
  });

  it('scrolls the page to show the form\'s Save above the keyboard from its last field', () => {
    // Save at 380–424 sat half under the keyboard (the visible part ends at 400).
    const { folder, save, scrolled } = page();
    folder.focus();
    revealFocusedField(document.documentElement);
    expect(scrolled()).toBe(24);
    expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(400);
  });

  it('counts the header pinned under the status-bar scrim when the nav is at the bottom', () => {
    const { folder, scrolled } = page();
    // The scrim covers 0–59 (the status bar), the toolbar sticks under it at 59–103.
    const scrim = document.createElement('div');
    scrim.className = 'app-status-scrim';
    vi.spyOn(scrim, 'getBoundingClientRect').mockReturnValue({ top: 0, bottom: 59 } as DOMRect);
    const bar = document.createElement('header');
    bar.className = 'page-toolbar';
    vi.spyOn(bar, 'getBoundingClientRect').mockReturnValue({ top: 59, bottom: 103 } as DOMRect);
    document.body.prepend(scrim, bar);
    // The field at 120–156, Save 300 px lower: lifting Save would put the field under the header.
    vi.mocked(folder.getBoundingClientRect).mockImplementation(() => ({ top: 120 - scrolled(), bottom: 156 - scrolled() }) as DOMRect);
    folder.focus();
    revealFocusedField(document.documentElement);
    expect(scrolled()).toBe(0);
  });

  it('keeps the field below a sticky toolbar rather than Save when both do not fit', () => {
    const { folder, scrolled } = page({ toolbar: true });
    // The field at 60–96, just under the 44 px toolbar, and Save 340 px lower.
    vi.mocked(folder.getBoundingClientRect).mockImplementation(() => ({ top: 60 - scrolled(), bottom: 96 - scrolled() }) as DOMRect);
    folder.focus();
    revealFocusedField(document.documentElement);
    expect(scrolled()).toBe(0);
  });
});

describe('followPageKeyboard', () => {
  function setUp(visibleHeight: number, offsetTop = 0) {
    vi.stubGlobal('visualViewport', {
      height: visibleHeight,
      offsetTop,
      scale: 1,
      addEventListener() {},
      removeEventListener() {},
    });
    // The layout viewport (jsdom has no layout): the keyboard doesn't change it.
    Object.defineProperty(document.documentElement, 'clientHeight', { value: window.innerHeight, configurable: true });
    vi.spyOn(window, 'scrollBy').mockImplementation(() => {});
    const main = document.createElement('main');
    const field = document.createElement('input');
    const other = document.createElement('input');
    const button = document.createElement('button');
    main.append(field, other, button);
    const sheet = document.createElement('input');
    document.body.append(main, sheet);
    const stop = followPageKeyboard(main);
    return { main, field, other, button, sheet, stop };
  }
  const marked = () => document.documentElement.hasAttribute('data-page-keyboard');

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    document.documentElement.removeAttribute('data-page-keyboard');
    Reflect.deleteProperty(document.documentElement, 'clientHeight');
    document.body.replaceChildren();
  });

  it('on iOS, focuses a tapped toolbar field out of Safari\'s sight, so Safari does not scroll the list to it', () => {
    vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('Mozilla/5.0 (iPhone; CPU iPhone OS 27_0 like Mac OS X)');
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => frames.push(callback));
    const { main, stop } = setUp(window.innerHeight - 300);
    const toolbar = document.createElement('div');
    toolbar.className = 'page-toolbar';
    const search = document.createElement('input');
    toolbar.append(search);
    main.prepend(toolbar);
    const touch = (type: string, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'changedTouches', { value: [{ clientX: 50, clientY: y }] });
      search.dispatchEvent(event);
      return event;
    };
    try {
      touch('touchstart', 80);
      const end = touch('touchend', 80);
      expect(end.defaultPrevented).toBe(true);
      expect(document.activeElement).toBe(search);
      expect(search.style.transform).toBe('translateY(-2000px)');
      frames.forEach((frame) => frame(0));
      expect(search.style.transform).toBe('');
      // A drag that ends on it is a scroll, not a tap.
      search.blur();
      touch('touchstart', 80);
      expect(touch('touchend', 140).defaultPrevented).toBe(false);
    } finally {
      stop();
    }
  });

  it('keeps the page marked while iOS has panned the visible part down to the keyboard', () => {
    // A 300 px keyboard, the visible part panned 300 px down: nothing below it is covered.
    const { field, stop } = setUp(window.innerHeight - 300, 300);
    try {
      field.focus();
      expect(marked()).toBe(true);
    } finally {
      stop();
    }
  });

  it('marks the page while the keyboard is up for one of its fields, through ⌄ to the next', () => {
    const { field, other, button, stop } = setUp(window.innerHeight - 300);
    expect(marked()).toBe(false);
    field.focus();
    expect(marked()).toBe(true);
    other.focus();
    expect(marked()).toBe(true);
    button.focus();
    expect(marked()).toBe(false);
    other.focus();
    stop();
    expect(marked()).toBe(false);
  });

  it('lets go once a focused field is removed without a focusout, when a sheet\'s field takes focus', () => {
    const { field, sheet } = setUp(window.innerHeight - 300);
    field.focus();
    expect(marked()).toBe(true);
    // Go saved and the page moved on: browsers fire no focusout for a removed field.
    field.addEventListener('focusout', (event) => event.stopImmediatePropagation(), { capture: true });
    field.remove();
    sheet.focus();
    expect(marked()).toBe(false);
  });

  it('shows Save again when the form grows under the field while the keyboard is up', () => {
    let grow: () => void = () => {};
    vi.stubGlobal('ResizeObserver', class {
      constructor(callback: () => void) { grow = callback; }
      observe() {}
      disconnect() {}
    });
    Object.defineProperty(document, 'scrollingElement', { value: document.documentElement, configurable: true });
    let scrolled = 0;
    const { main } = setUp(400);
    vi.mocked(window.scrollBy).mockImplementation(((_x: number, y: number) => { scrolled += y; }) as typeof window.scrollBy);
    const form = document.createElement('form');
    const folder = document.createElement('input');
    const save = document.createElement('button');
    save.type = 'submit';
    form.append(folder, save);
    main.append(form);
    let saveTop = 340;
    vi.spyOn(folder, 'getBoundingClientRect').mockImplementation(() => ({ top: 200 - scrolled, bottom: 236 - scrolled }) as DOMRect);
    vi.spyOn(save, 'getBoundingClientRect').mockImplementation(() => ({ top: saveTop - scrolled, bottom: saveTop + 44 - scrolled }) as DOMRect);
    folder.focus();
    expect(marked()).toBe(true);
    expect(scrolled).toBe(0);
    // A new name adds Move Files and the new path between the field and Save.
    saveTop = 460;
    grow();
    expect(save.getBoundingClientRect().bottom).toBeLessThanOrEqual(400);
    expect(folder.getBoundingClientRect().top).toBeGreaterThanOrEqual(0);
    Reflect.deleteProperty(document, 'scrollingElement');
  });

  it('leaves the page alone for a field in a sheet, and with no keyboard up', () => {
    const { field, sheet } = setUp(window.innerHeight);
    sheet.focus();
    expect(marked()).toBe(false);
    field.focus();
    expect(marked()).toBe(false);
  });
});
