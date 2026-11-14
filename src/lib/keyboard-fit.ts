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

function isIOS() {
  return /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** iOS Safari in a tab, not the Home Screen app (which has no address bar). */
export function inSafariTab() {
  const homeScreen =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia?.('(display-mode: standalone)').matches;
  return isIOS() && !homeScreen;
}

/**
 * Calls `place` with how much of the layout viewport the keyboard covers (0
 * once it has closed) and the visual viewport, now and on every change, until
 * the returned stop is called. Every change is worked out from the viewport
 * as it is now, so once the keyboard closes the overlay can go back to its own
 * classes, whatever happened while it was open. When the keyboard opens or
 * changes size, the focused field inside `node` is scrolled into view.
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
      place(0, viewport);
      return;
    }
    place(covered, viewport);
    // Only when the keyboard opens or changes size, not on every iOS pan, so
    // a body scrolled away from the field while typing stays where it is.
    if (viewport.height !== visibleHeight) revealFocusedField(node);
    visibleHeight = viewport.height;
  };
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(measure);
  };
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
 * Scrolls the overlay (or the box in it that scrolls) so the field being
 * typed in sits near its top, with what follows it (the next field, the
 * button that sends the form) in view above the keyboard rather than under it.
 */
export function revealFocusedField(node: HTMLElement) {
  const field = document.activeElement;
  if (!(field instanceof HTMLElement) || !node.contains(field)) return;
  for (let box = field.parentElement; box && node.contains(box); box = box.parentElement) {
    if (box.scrollHeight <= box.clientHeight) continue;
    const overflow = getComputedStyle(box).overflowY;
    if (overflow !== 'auto' && overflow !== 'scroll') continue;
    // Its label sits just above it.
    box.scrollTop += field.getBoundingClientRect().top - box.getBoundingClientRect().top - 40;
    return;
  }
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
