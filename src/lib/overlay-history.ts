'use client';

import { useEffect, useEffectEvent, useState } from 'react';

// The system Back (Android's button or gesture, the browser's Back, an iOS
// edge swipe) closes the top-most open sheet or dialog before it leaves the
// page. A browser can only hand Back to the page as a history traversal, so
// each open overlay pushes one entry onto history, at the same URL, and Back
// landing below it closes it.
//
// The entries are shared by every overlay on the page, and the app router
// reads history too, so they are kept here, in one place:
// - An entry carries the page's own history.state (the router's __NA and
//   tree) plus a marker. Without them the router would reload the page when
//   Back lands on it.
// - An overlay closed any other way (Cancel, a pick, the backdrop, a swipe)
//   takes its entry back off with history.back(), so the next Back leaves
//   the page as it would have.
// - An in-app navigation started while entries are on top waits until they
//   are off (see NavigationProvider). Otherwise it would push past them and
//   the next Back would land on a dead entry, or the history.back() taking
//   them off would undo the navigation.
// - Only one of our traversals is in flight at a time; everything else waits
//   for it, since a pushState made meanwhile would be the entry it leaves.

const MARKER = '__helprrOverlay';

type Entry = {
  id: number;
  /** Closes the overlay when Back takes its entry; null once it has closed. */
  onBack: (() => void) | null;
  /** history.length and the path just after the push, to recognise the entry
   *  after a replaceState that dropped the marker. */
  length: number;
  pathname: string;
};

/** Our entries on history, bottom first, the current one last. */
const entries: Entry[] = [];
let nextId = 1;
let traversing = false;
let traverseTimer: ReturnType<typeof setTimeout> | undefined;
/** The URL to keep once our traversal lands (see go()). */
let keepHref: string | null = null;
/** Work waiting for our traversal to land. */
let waiting: Array<() => void> = [];
let flushQueued = false;
let listening = false;

function stateMarker(): unknown {
  return (window.history.state as Record<string, unknown> | null)?.[MARKER];
}

/** Whether the current history entry is our top entry. */
function onTopEntry(): boolean {
  const top = entries[entries.length - 1];
  if (!top) return false;
  const marker = stateMarker();
  if (marker !== undefined) return marker === top.id;
  // A replaceState that keeps no custom keys (the router refreshing the
  // entry, a page mirroring its filters into the URL) rewrites our entry in
  // place. A push over it would have added an entry, usually for another page.
  return window.history.length === top.length && window.location.pathname === top.pathname;
}

function whenSettled(run: () => void) {
  if (traversing) waiting.push(run);
  else run();
}

function settle() {
  traversing = false;
  clearTimeout(traverseTimer);
  while (!traversing && waiting.length) waiting.shift()!();
}

/** Goes back `count` entries, then runs `then` before anything else waiting. */
function go(count: number, then?: () => void) {
  traversing = true;
  // A page that rewrote the URL while an overlay was open (Activity's
  // filters) left the entry below with the old one: keep the new one.
  keepHref = window.location.href;
  if (then) waiting.unshift(then);
  // Landing at the edge of history fires no popstate.
  traverseTimer = setTimeout(settle, 1000);
  window.history.go(-count);
}

function onPopState() {
  if (traversing) {
    if (keepHref && window.location.href !== keepHref) {
      // Through the router's patched replaceState (no __NA), so it takes the URL too.
      const own = { ...((window.history.state as Record<string, unknown> | null) ?? {}) };
      delete own.__NA;
      delete own.__PRIVATE_NEXTJS_INTERNALS_TREE;
      window.history.replaceState(own, '', keepHref);
    }
    keepHref = null;
    clearTimeout(traverseTimer);
    // After every other popstate listener: the scroll restorer would take a
    // navigation started here for part of this traversal.
    traverseTimer = setTimeout(settle, 0);
    return;
  }
  // Back (or Forward) from the user: close every overlay above the entry it
  // landed on, the top one for a single Back.
  const marker = stateMarker();
  const at = entries.findIndex((entry) => entry.id === marker);
  const taken = entries.splice(at + 1);
  for (const entry of taken.reverse()) {
    const onBack = entry.onBack;
    entry.onBack = null;
    onBack?.();
  }
  // It may have landed on the entry of an overlay that closed meanwhile.
  queueFlush();
}

/** Takes the entries of overlays that have closed off the top of history. */
function queueFlush() {
  if (flushQueued) return;
  flushQueued = true;
  // A microtask, so an overlay opening in the same commit (a confirm from a
  // ⋯ sheet's action) takes the closing one's entry over instead.
  queueMicrotask(() => {
    flushQueued = false;
    whenSettled(() => {
      let closed = 0;
      while (closed < entries.length && !entries[entries.length - 1 - closed].onBack) closed++;
      if (!closed) return;
      const current = onTopEntry();
      entries.splice(entries.length - closed);
      // Something else pushed over them: leave history alone rather than
      // send the user back from where they went.
      if (current) go(closed);
    });
  });
}

function openEntry(onBack: () => void): Entry {
  const entry: Entry = { id: nextId++, onBack, length: 0, pathname: '' };
  if (!listening) {
    listening = true;
    window.addEventListener('popstate', onPopState);
  }
  whenSettled(() => {
    if (!entry.onBack) return;
    const state = { ...((window.history.state as object | null) ?? {}), [MARKER]: entry.id };
    const top = entries[entries.length - 1];
    if (top && !top.onBack && onTopEntry()) {
      window.history.replaceState(state, '');
      entries.pop();
    } else {
      window.history.pushState(state, '');
    }
    entry.length = window.history.length;
    entry.pathname = window.location.pathname;
    entries.push(entry);
  });
  return entry;
}

function closeEntry(entry: Entry) {
  if (!entry.onBack) return;
  entry.onBack = null;
  queueFlush();
}

/**
 * Runs an in-app navigation once no overlay entry is on top of history: at
 * once when there is none (the usual case), else after taking them off and
 * closing their overlays.
 */
export function afterOverlayHistory(navigate: () => void) {
  if (!traversing && entries.length === 0) return navigate();
  whenSettled(() => {
    if (!onTopEntry()) return navigate();
    const taken = entries.splice(0);
    for (const entry of taken.reverse()) {
      const onBack = entry.onBack;
      entry.onBack = null;
      onBack?.();
    }
    go(taken.length, navigate);
  });
}

/**
 * Lets the system Back close an overlay while `open`: one history entry
 * while it is open, and `close` when Back takes it.
 */
export function useCloseOnBack(open: boolean, close: () => void) {
  // Bumped when Back takes the entry, so an overlay that refused to close
  // (a busy confirm) puts a new one up for the next Back.
  const [backs, setBacks] = useState(0);
  const onBack = useEffectEvent(() => {
    setBacks((count) => count + 1);
    close();
  });
  useEffect(() => {
    if (!open) return;
    const entry = openEntry(onBack);
    return () => closeEntry(entry);
  }, [open, backs]);
}

/**
 * The open state of a sheet or dialog that the system Back closes, for the
 * shared overlay roots: controlled when `open` is given, else held here.
 */
export function useBackClosableOpen(
  open: boolean | undefined,
  defaultOpen: boolean | undefined,
  onOpenChange: ((open: boolean) => void) | undefined,
): [boolean, (open: boolean) => void] {
  const [ownOpen, setOwnOpen] = useState(defaultOpen ?? false);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  useCloseOnBack(isOpen, () => setOpen(false));
  return [isOpen, setOpen];
}

export function resetOverlayHistoryForTests() {
  entries.length = 0;
  waiting = [];
  traversing = false;
  keepHref = null;
  flushQueued = false;
  clearTimeout(traverseTimer);
}
