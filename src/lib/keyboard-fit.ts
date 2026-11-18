'use client';

// Keeps sheets and dialogs usable with a phone's on-screen keyboard. iOS and
// Android Chrome shrink only the visual viewport for the keyboard; the layout
// viewport that fixed overlays are placed in stays full height, so the
// keyboard covers whatever sits in its lower part. The drawer and the dialog
// each place themselves in the part left visible (see followKeyboard); both
// share the iOS guard and the focused-field reveal below.

export function isTextField(target: EventTarget | null): target is HTMLInputElement | HTMLTextAreaElement {
  return (
    target instanceof HTMLTextAreaElement ||
    (target instanceof HTMLInputElement &&
      !['checkbox', 'radio', 'button', 'submit', 'reset', 'range', 'color', 'file'].includes(target.type))
  );
}

/** Focus that brings up the on-screen keyboard (or, for a select, iOS's picker). */
export function opensKeyboard(target: EventTarget | null) {
  // A read-only field takes focus but opens no keyboard.
  if ((target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) && target.readOnly) return false;
  return isTextField(target) || target instanceof HTMLSelectElement || (target instanceof HTMLElement && target.isContentEditable === true);
}

export function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** iOS Safari in a tab, not the Home Screen app (which has no address bar). */
export function inSafariTab() {
  const homeScreen =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return isIOS() && !homeScreen;
}

/** How long (about 4 frames) iOS's brief scroll of the visible part may last before it is followed. */
export const PAN_HOLD_MS = 70;
/** How long the visible part must stay put before a new move of it is held again. */
export const PAN_STILL_MS = 100;

/**
 * Calls `place` with how much of the layout viewport the keyboard covers (0
 * once it has closed) and the visual viewport, now and on every change, until
 * the returned stop is called. Every change is worked out from the viewport
 * as it is now, so once the keyboard closes the overlay can go back to its own
 * classes, whatever happened while it was open. When the keyboard opens or
 * changes size, the focused field inside `node` is scrolled into view.
 *
 * When focus moves to another field of `node` with the keyboard up, iOS
 * scrolls the visual viewport towards it for a frame or three and then back
 * (offsetTop 26 or 123 on an iPhone 18 Pro, height unchanged). Followed, a
 * pinned sheet dipped by that much and sprang back on every ⌄ / ⌃ or tap. So
 * on iOS the first move of the visible part alone, away from a steady
 * placement, keeps that placement until it goes back or has lasted
 * PAN_HOLD_MS. One that lasts is a real pan (a drag, or iOS's animated scroll
 * to a hidden field): it is followed then, and so is every later frame of it
 * at once, until the visible part has stayed put for PAN_STILL_MS.
 */
export function followKeyboard(node: HTMLElement, place: (covered: number, viewport: VisualViewport) => void): () => void {
  const viewport = window.visualViewport;
  if (!viewport) return () => {};
  // The box fixed elements are placed in, measured rather than taken from
  // window.innerHeight: iOS briefly reports the visible height there while the
  // keyboard moves, and a drawer placed from that stayed behind the keyboard.
  const layout = document.createElement('div');
  layout.setAttribute('aria-hidden', 'true');
  layout.style.cssText = 'position:fixed;inset:0;visibility:hidden;pointer-events:none';
  document.body.appendChild(layout);
  let frame = 0;
  let visibleHeight = 0;
  // The last placement while the keyboard is up; since when a move away from
  // it has been held (null: none is); when a move was last followed.
  let placed: { covered: number; height: number } | null = null;
  let movedAt: number | null = null;
  let followedAt = -Infinity;
  let recheck = 0;
  const ios = isIOS();
  const measure = () => {
    frame = 0;
    // The part of the layout viewport the keyboard covers, under the visible
    // part. A pinch zoom shrinks the visual viewport too, but changes its
    // scale; a keyboard leaves it at 1.
    // (Unmeasured, as in tests without layout, it falls back to innerHeight.)
    const layoutBottom = layout.getBoundingClientRect().bottom || window.innerHeight;
    const covered = viewport.scale > 1.01 ? 0 : Math.round(layoutBottom - viewport.height - viewport.offsetTop);
    if (covered < 1) {
      visibleHeight = 0;
      placed = null;
      movedAt = null;
      followedAt = -Infinity;
      place(0, viewport);
      return;
    }
    if (ios && placed && placed.height === viewport.height && placed.covered !== covered) {
      const now = performance.now();
      // Still panning: follow this frame too.
      if (now - followedAt >= PAN_STILL_MS) {
        movedAt ??= now;
        if (now - movedAt < PAN_HOLD_MS) {
          // Look again once it has lasted that long, in case it stays.
          if (!recheck) recheck = window.setTimeout(() => {
            recheck = 0;
            schedule();
          }, PAN_HOLD_MS - (now - movedAt) + 1);
          return;
        }
      }
      followedAt = now;
    }
    movedAt = null;
    placed = { covered, height: viewport.height };
    place(covered, viewport);
    // Only when the keyboard opens or changes size, not on every iOS pan, so
    // a body scrolled away from the field while typing stays where it is.
    if (viewport.height !== visibleHeight) revealFocusedField(node);
    visibleHeight = viewport.height;
  };
  function schedule() {
    if (!frame) frame = requestAnimationFrame(measure);
  }
  // iOS can still be mid-way through the keyboard's move when it reports a
  // size; look again once it has settled.
  let settle: number[] = [];
  const onResize = () => {
    schedule();
    settle.forEach((timer) => window.clearTimeout(timer));
    settle = [150, 400].map((ms) => window.setTimeout(schedule, ms));
  };
  viewport.addEventListener('resize', onResize);
  // iOS pans the visual viewport, or scrolls the page, to show a field the
  // keyboard would hide (also when an autocorrect suggestion is tapped).
  viewport.addEventListener('scroll', schedule);
  window.addEventListener('resize', onResize);
  window.addEventListener('scroll', schedule);
  measure();
  return () => {
    viewport.removeEventListener('resize', onResize);
    viewport.removeEventListener('scroll', schedule);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('scroll', schedule);
    settle.forEach((timer) => window.clearTimeout(timer));
    window.clearTimeout(recheck);
    cancelAnimationFrame(frame);
    layout.remove();
  };
}

/**
 * Stops iOS scrolling the page to show a field in a drawer or dialog;
 * followKeyboard keeps the field in view instead. With the page scrolled
 * under it, iOS drew the fixed overlay lower than it measured, by as much as
 * it had scrolled, so the field and buttons ended up behind the keyboard. Only
 * while a field in the overlay has focus does a scroll go back to where the
 * page was then: opening and closing a drawer scrolls the page too (vaul holds
 * it in place under the drawer in Safari) and must be left alone.
 */
export function keepIosFromScrolling(node: HTMLElement): () => void {
  if (!isIOS()) return () => {};
  let pinned: { x: number; y: number } | null = null;
  let start: { x: number; y: number } | null = null;
  // Safari only scrolls to a field it thinks is off screen, so this does
  // the scrolling itself, inside the overlay: focus moving to the next field
  // with the keyboard up would otherwise leave it below the fold.
  const hideFromSafari = (field: HTMLElement) => {
    field.style.transform = 'translateY(-2000px)';
    requestAnimationFrame(() => {
      field.style.transform = '';
      revealFocusedField(node);
    });
  };
  const onTouchStart = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    start = touch ? { x: touch.clientX, y: touch.clientY } : null;
  };
  const onTouchEnd = (event: TouchEvent) => {
    const field = event.target;
    const touch = event.changedTouches[0];
    if (!isTextField(field) || field === document.activeElement || !start || !touch) return;
    // A scroll that happens to end on a field is not a tap on it.
    if (Math.abs(touch.clientX - start.x) > 10 || Math.abs(touch.clientY - start.y) > 10) return;
    // Tapped: focus it ourselves, hidden, so Safari has nothing to scroll to.
    event.preventDefault();
    hideFromSafari(field);
    field.focus();
  };
  const onFocusIn = (event: FocusEvent) => {
    if (!isTextField(event.target)) return;
    pinned ??= { x: window.scrollX, y: window.scrollY };
    // Focus can also move another way, e.g. the keyboard's next and previous arrows.
    hideFromSafari(event.target);
  };
  const onFocusOut = (event: FocusEvent) => {
    if (!isTextField(event.relatedTarget) || !node.contains(event.relatedTarget)) pinned = null;
  };
  const onScroll = () => {
    // An overlay closing with a field still focused lets go at once: vaul
    // scrolls the page back to where it was as the close starts.
    const field = document.activeElement;
    if (node.getAttribute('data-state') !== 'open' || !isTextField(field) || !node.contains(field)) pinned = null;
    if (pinned && (window.scrollX !== pinned.x || window.scrollY !== pinned.y)) window.scrollTo(pinned.x, pinned.y);
  };
  node.addEventListener('touchstart', onTouchStart, { capture: true, passive: true });
  node.addEventListener('touchend', onTouchEnd, { capture: true, passive: false });
  node.addEventListener('focusin', onFocusIn, true);
  node.addEventListener('focusout', onFocusOut, true);
  window.addEventListener('scroll', onScroll);
  return () => {
    node.removeEventListener('touchstart', onTouchStart, true);
    node.removeEventListener('touchend', onTouchEnd, true);
    node.removeEventListener('focusin', onFocusIn, true);
    node.removeEventListener('focusout', onFocusOut, true);
    window.removeEventListener('scroll', onScroll);
  };
}

/**
 * Scrolls the overlay (or the box in it that scrolls) as little as it takes
 * to show the field being typed in and the centres of the fields either side
 * of it. iOS's ⌃ / ⌄ keyboard arrows skip a field whose centre is not on
 * screen (WebKit hit-tests it, bugs 220929 and 242060), so a field scrolled
 * out of the box, above or below, could no longer be reached with them; an
 * earlier rule that put the focused field near the box's top did that to the
 * field before it. When both neighbours don't fit, the next one wins: it is
 * the way through the form, towards the button that sends it. On the form's
 * last field that button is the way on, so it is shown too when it fits in
 * the same box (a sheet scrolling as one column has it under the fields:
 * two-step's Turn on sat behind the keyboard until dragged), after the field
 * above, which ⌃ needs. A read-only field is no neighbour here: iOS's arrows
 * skip it.
 */
export function revealFocusedField(node: HTMLElement) {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !node.contains(field)) return;
  for (let box = field.parentElement; box && node.contains(box); box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight) continue;
    const overflow = getComputedStyle(box).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    const viewTop = box.getBoundingClientRect().top + box.clientTop;
    const viewBottom = viewTop + box.clientHeight;
    // How far the box may scroll (+ is down) and keep `top`–`bottom` in view.
    const keep = (top: number, bottom: number) => ({ min: bottom - viewBottom, max: top - viewTop });
    const fieldRect = field.getBoundingClientRect();
    let range = keep(fieldRect.top, fieldRect.bottom);
    // iOS's arrows skip a read-only field: on two-step's code step ⌃ is
    // disabled, the key field above being read-only (iOS 27 Simulator, SE).
    // arrowRoomNeeded still counts it, so the scroll-together switch is unchanged.
    const fields = [...node.querySelectorAll<HTMLElement>('input, textarea, select')].filter(
      (el) => el === field || (isArrowStop(el) && !('readOnly' in el && el.readOnly)),
    );
    const at = fields.indexOf(field);
    // The nearest field each way with a box: one hidden by CSS has none, and
    // the arrows go on to the one after it. None when focus isn't on a field.
    const nearest = (step: 1 | -1) => {
      for (let i = at + step; at >= 0 && i >= 0 && i < fields.length; i += step) {
        const rect = fields[i].getBoundingClientRect();
        if (rect.bottom > rect.top) return { el: fields[i], rect };
      }
      return null;
    };
    const next = nearest(1);
    const send = at >= 0 && !next ? sendButton(field) : null;
    for (const found of [next, nearest(-1), send]) {
      // One in a part that doesn't scroll (a pinned search box or buttons) doesn't move.
      if (!found || !box.contains(found.el)) continue;
      const { rect } = found;
      const centre = (rect.top + rect.bottom) / 2;
      // A field needs its centre in view for the arrows; the button, all of it for a tap.
      const [top, bottom] = found === send ? [rect.top, rect.bottom] : [centre - 4, centre + 4];
      const both = { min: Math.max(range.min, bottom - viewBottom), max: Math.min(range.max, top - viewTop) };
      if (both.min <= both.max) range = both;
    }
    // Taller than the box (a long text area): show its top.
    const by = range.min > range.max ? range.max : Math.min(Math.max(0, range.min), range.max);
    if (by) box.scrollTop += by;
    return;
  }
}

/**
 * The height a form's scroll box needs for iOS's ⌃ / ⌄ arrows to work on every
 * field: the field whole plus the centres (4 px inside, as revealFocusedField
 * keeps them) of the fields either side of it, for the field that needs the
 * most. `fields` are the arrow stops' boxes, top to bottom.
 */
export function arrowRoomNeeded(fields: ReadonlyArray<{ top: number; bottom: number }>): number {
  const centre = (rect: { top: number; bottom: number }) => (rect.top + rect.bottom) / 2;
  return fields.reduce((need, rect, i) => {
    const prev = fields[i - 1];
    const next = fields[i + 1];
    const top = prev ? Math.min(rect.top, centre(prev) - 4) : rect.top;
    const bottom = next ? Math.max(rect.bottom, centre(next) + 4) : rect.bottom;
    return Math.max(need, bottom - top);
  }, 0);
}

/**
 * Whether the form's own scroll box in a `scrollTogether` sheet (`scroll`, its
 * drawer-scroll box) is shorter than arrowRoomNeeded, with the sheet's header
 * and buttons pinned around it. On a short phone above the keyboard they leave
 * it room for little more than one field, and iOS's arrows then skip the
 * fields either side. Worked out the same way whether the header and buttons are
 * pinned (`scroll` fits, the body has the rest) or scroll with the fields (the
 * body is its full height, and `scroll` overflows by what pinning them would
 * take from it), so the layout does not flip back once switched. That holds
 * while the header and buttons can't shrink and the boxes marked min-h-0 are
 * the only ones that do.
 *
 * Undefined (keep the layout as it is) while a field is moved by an inline
 * transform: keepIosFromScrolling lifts a newly focused field 2000 px for a
 * frame, and its box then reads as needing that much room.
 */
export function formRoomTooShort(scroll: HTMLElement): boolean | undefined {
  const candidates = [...scroll.querySelectorAll<HTMLElement>('input, textarea, select')].filter(isArrowStop);
  if (candidates.some((el) => el.style.transform)) return undefined;
  const fields = candidates
    .map((el) => ({ el, rect: el.getBoundingClientRect() }))
    .filter(({ rect }) => rect.bottom > rect.top);
  if (!fields.length) return false;
  // The form's body: the box that scrolls its first field, inside `scroll`.
  let body = fields[0].el.parentElement;
  while (body && body !== scroll && !['auto', 'scroll'].includes(getComputedStyle(body).overflowY)) body = body.parentElement;
  if (!body || body === scroll) return false;
  const box = body;
  const room = box.clientHeight - Math.max(0, scroll.scrollHeight - scroll.clientHeight);
  return room < arrowRoomNeeded(fields.filter(({ el }) => box.contains(el)).map(({ rect }) => rect));
}

/**
 * The focused field's form's default button (the first that submits it: a
 * <button> with no type does, and one outside the form joined by form="…"
 * counts), if it is on screen.
 */
function sendButton(field: HTMLElement) {
  const form = 'form' in field ? (field as HTMLInputElement).form : null;
  const el = form && [...form.elements].find(
    (control): control is HTMLButtonElement | HTMLInputElement =>
      (control instanceof HTMLButtonElement || control instanceof HTMLInputElement) && control.type === 'submit',
  );
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  return rect.bottom > rect.top ? { el, rect } : null;
}

/** A field the keyboard's ⌃ / ⌄ arrows go to: shown, enabled, typed into or picked from. */
function isArrowStop(el: HTMLElement) {
  if (!(isTextField(el) || el instanceof HTMLSelectElement) || el.disabled || el.closest('[hidden], [inert]')) return false;
  return !(el instanceof HTMLInputElement && el.type === 'hidden');
}

/**
 * Keeps a centred dialog in the part of the screen the keyboard leaves
 * visible: centred in the full window, its fields and buttons sat behind the
 * keyboard. `anchorTop` is the top offset of a dialog placed from the top
 * instead (its class's value, e.g. "12%"). With the iOS guard, as for drawers.
 */
export function keepCentredDialogAboveKeyboard(node: HTMLElement, anchorTop?: string): () => void {
  const stopFitting = followKeyboard(node, (covered, viewport) => {
    if (!covered) {
      node.style.removeProperty('top');
      node.style.removeProperty('max-height');
      return;
    }
    // In a Safari tab, Safari's floating address bar sits over the bottom of
    // what is left, and a tap there goes to Safari.
    const visible = viewport.height - (inSafariTab() ? 60 : 0);
    if (anchorTop) {
      // A dialog placed from the top (Search) stays there, moved only by an
      // iOS pan, and gets shorter, so its list ends above the keyboard; moving
      // its top edge to the middle put the list behind it. A percentage top
      // and max-height both refer to the layout viewport, so the class's
      // offset works here.
      node.style.top = `calc(${anchorTop} + ${viewport.offsetTop}px)`;
      node.style.maxHeight = `calc(${visible}px - ${anchorTop} - 0.75rem)`;
      return;
    }
    // Between the status bar (or a 0.75rem margin) and a 0.75rem margin.
    node.style.top = `calc(${viewport.offsetTop + visible / 2}px + (max(env(safe-area-inset-top), 0.75rem) - 0.75rem) / 2)`;
    node.style.maxHeight = `calc(${visible}px - max(env(safe-area-inset-top), 0.75rem) - 0.75rem)`;
  });
  const stopGuarding = keepIosFromScrolling(node);
  return () => {
    stopFitting();
    stopGuarding();
  };
}
