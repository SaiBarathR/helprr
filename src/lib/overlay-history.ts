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
//   takes its entry back off with history.go(), so the next Back leaves the
//   page as it would have.
// - An in-app navigation started while entries are on top waits until they
//   are off (see NavigationProvider). Otherwise it would push past them and
//   the next Back would land on a dead entry, or the traversal taking them
//   off would undo the navigation.
// - Only one traversal is settled at a time; everything else waits for it,
//   since a pushState made meanwhile would be the entry it leaves.
// - These popstates are not navigations: listeners that act on Back (the
//   player collapsing, the scroll restorer) skip them via isOverlayPopState.

const MARKER = '__helprrOverlay';
const ROUTER_KEYS = ['__NA', '__PRIVATE_NEXTJS_INTERNALS_TREE'];

type Entry = {
  id: number;
  /** Closes the overlay when Back takes its entry; null once it has closed. */
  onBack: (() => void) | null;
  /** The Navigation API's key for the entry, which survives replaceState. */
  key: string | null;
  /** Without that API: history.length and the path just after the push, to
   *  recognise the entry after a replaceState that dropped the marker. */
  length: number;
  pathname: string;
};

type NavigationEntryLike = { key: string; index: number; url: string | null };
type NavigationLike = EventTarget & {
  currentEntry: NavigationEntryLike | null;
  canGoForward: boolean;
  entries(): NavigationEntryLike[];
};

/** Our entries on history, bottom first, the current one last. */
const entries: Entry[] = [];
let nextId = 1;
/** A traversal (ours, or a Back that closed overlays) is being settled. */
let traversing = false;
/** Our step past a closed overlay's entry, and its direction: to everyone
 *  else it is the user's own Back or Forward. */
let stepping: 1 | -1 | 0 = 0;
let traverseTimer: ReturnType<typeof setTimeout> | undefined;
/** The URL and page state to keep once our traversal lands (see goBack()). */
let keep: { href: string; state: Record<string, unknown> } | null = null;
/** Overlays to close once the traversal has landed. */
let closing: Entry[] = [];
/** Work waiting for the traversal to settle. */
let waiting: Array<() => void> = [];
let flushQueued = false;
let listening = false;
/** Which way the latest Back or Forward went, where the Navigation API says. */
let lastTraverse = -1;
const ownPopStates = new WeakMap<Event, boolean>();

function navigationApi(): NavigationLike | undefined {
  return (window as Window & { navigation?: NavigationLike }).navigation;
}

function currentState(): Record<string, unknown> {
  return (window.history.state as Record<string, unknown> | null) ?? {};
}

function stateMarker(): unknown {
  return currentState()[MARKER];
}

/** The page's own keys in an entry's state, without the router's or ours. */
function pageState(state: Record<string, unknown>): Record<string, unknown> {
  const own = { ...state };
  for (const key of [...ROUTER_KEYS, MARKER]) delete own[key];
  return own;
}

/** Whether the current history entry is our top entry. */
function onTopEntry(): boolean {
  const top = entries[entries.length - 1];
  if (!top) return false;
  const current = navigationApi()?.currentEntry?.key;
  if (top.key && current) return current === top.key;
  const marker = stateMarker();
  if (marker !== undefined) return marker === top.id;
  // A replaceState that keeps no custom keys (the router refreshing the
  // entry, a page mirroring its filters into the URL) rewrites our entry in
  // place. A push over it would have added an entry, usually for another page.
  return window.history.length === top.length && window.location.pathname === top.pathname;
}

/**
 * Whether a popstate only closed overlays or took their entries off, rather
 * than going to another view. Worked out from the state before this module
 * handles the event, so any listener can ask, whichever runs first.
 */
export function isOverlayPopState(event: Event): boolean {
  let own = ownPopStates.get(event);
  if (own === undefined) {
    const top = entries[entries.length - 1];
    own = traversing
      ? stepping === 0
      : Boolean(top) && stateMarker() !== top.id && window.location.pathname === top.pathname;
    ownPopStates.set(event, own);
  }
  return own;
}

function whenSettled(run: () => void) {
  if (traversing) waiting.push(run);
  else run();
}

function settle() {
  traversing = false;
  stepping = 0;
  keep = null;
  clearTimeout(traverseTimer);
  const close = closing;
  closing = [];
  // Only the ones still open: an overlay that closed itself meanwhile (its
  // own Cancel, a pick that also navigates) has had its onOpenChange.
  for (const entry of close) {
    const onBack = entry.onBack;
    entry.onBack = null;
    onBack?.();
  }
  while (!traversing && waiting.length) waiting.shift()!();
  // It may have landed on the entry of an overlay that closed meanwhile.
  if (!traversing) queueFlush();
}

/** Settles once every popstate listener has seen the event. */
function settleSoon() {
  clearTimeout(traverseTimer);
  traverseTimer = setTimeout(settle, 0);
}

/** Puts the URL and page state back on the entry Back landed on. */
function keepOnEntry(href: string, state: Record<string, unknown>) {
  const landed = pageState(currentState());
  if (href === window.location.href && JSON.stringify(landed) === JSON.stringify(state)) return;
  // Through the router's patched replaceState (no __NA), so it takes the URL
  // too and copies its own keys over from the entry.
  window.history.replaceState({ ...state }, '', href);
}

/** Goes back `count` of our entries, closing `close` when it lands. */
function goBack(count: number, close: Entry[] = []) {
  traversing = true;
  // A page that changed the URL or its entry state while an overlay was open
  // (Activity's filters, Discover's browse mode on Apply) left the entry
  // below with the old ones: keep the new ones.
  keep = { href: window.location.href, state: pageState(currentState()) };
  closing.push(...close);
  clearTimeout(traverseTimer);
  // Landing at the edge of history fires no popstate.
  traverseTimer = setTimeout(settle, 1000);
  window.history.go(-count);
}

/** Steps past the entry of an overlay that has closed (Forward after Back
 *  closed it, or a reload), on in the way it went, else back. */
function stepPastClosed(direction: 1 | -1) {
  traversing = true;
  stepping = direction === 1 && navigationApi()?.canGoForward ? 1 : -1;
  clearTimeout(traverseTimer);
  traverseTimer = setTimeout(settle, 1000);
  window.history.go(stepping);
}

function onClosedEntry(): boolean {
  const marker = stateMarker();
  return marker !== undefined && !entries.some((entry) => entry.id === marker);
}

function onPopState(event: PopStateEvent) {
  isOverlayPopState(event);
  if (traversing) {
    if (stepping) {
      if (onClosedEntry()) return stepPastClosed(stepping);
    } else if (keep) {
      keepOnEntry(keep.href, keep.state);
    }
    settleSoon();
    return;
  }
  const marker = stateMarker();
  const at = entries.findIndex((entry) => entry.id === marker);
  if (at < entries.length - 1) {
    // Back from the user: close every overlay above the entry it landed on,
    // the top one for a single Back.
    const top = entries[entries.length - 1];
    // The URL the page had under the overlay, which it may have rewritten.
    const left = top.key ? navigationApi()?.entries().find((entry) => entry.key === top.key)?.url : null;
    if (left && new URL(left).pathname === window.location.pathname) {
      keepOnEntry(left, pageState(currentState()));
    }
    closing.push(...entries.splice(at + 1).reverse());
    traversing = true;
    if (marker !== undefined && at === -1) return stepPastClosed(-1);
    settleSoon();
    return;
  }
  if (onClosedEntry()) stepPastClosed(lastTraverse > 0 ? 1 : -1);
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
      if (current) goBack(closed);
    });
  });
}

function listen() {
  if (listening) return;
  listening = true;
  // Capture: at the window, before the router's and the page's listeners,
  // so the URL is back in place before they read it.
  window.addEventListener('popstate', onPopState, true);
  const api = navigationApi();
  api?.addEventListener('navigate', (event) => {
    const { navigationType, destination } = event as Event & { navigationType?: string; destination?: { index: number } };
    if (navigationType === 'traverse' && destination && api.currentEntry) {
      lastTraverse = destination.index - api.currentEntry.index;
    }
  });
}

function openEntry(onBack: () => void): Entry {
  const entry: Entry = { id: nextId++, onBack, key: null, length: 0, pathname: '' };
  listen();
  whenSettled(() => {
    if (!entry.onBack) return;
    const state = { ...currentState(), [MARKER]: entry.id };
    const top = entries[entries.length - 1];
    if (top && !top.onBack && onTopEntry()) {
      window.history.replaceState(state, '');
      entries.pop();
    } else {
      window.history.pushState(state, '');
    }
    entry.key = navigationApi()?.currentEntry?.key ?? null;
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
 * closing the overlays that haven't closed themselves.
 */
export function afterOverlayHistory(navigate: () => void) {
  if (!traversing && entries.length === 0) return navigate();
  whenSettled(() => {
    if (!onTopEntry()) return navigate();
    const taken = entries.splice(0).reverse();
    goBack(taken.length, taken);
    waiting.unshift(navigate);
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
  closing = [];
  traversing = false;
  stepping = 0;
  keep = null;
  flushQueued = false;
  lastTraverse = -1;
  clearTimeout(traverseTimer);
}
