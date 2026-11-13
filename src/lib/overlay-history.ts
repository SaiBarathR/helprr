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
let navigateListener: { api: NavigationLike; listener: (event: Event) => void } | null = null;
/** Which way the user's latest Back or Forward went, and the entry it left,
 *  where the Navigation API says. */
let lastTraverse = -1;
let lastFromKey: string | null = null;
/** Navigation API keys of entries whose overlay has closed. The router's own
 *  replaceState can drop our marker from an entry (Prowlarr's ?indexer=
 *  landing after the sheet's push), so the marker alone can't tell. */
const closedKeys = new Set<string>();
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

/** Whether the current entry belongs to an overlay that has closed. */
function onClosedEntry(): boolean {
  const marker = stateMarker();
  if (marker !== undefined && !entries.some((entry) => entry.id === marker)) return true;
  const key = navigationApi()?.currentEntry?.key;
  return Boolean(key && closedKeys.has(key));
}

/** Takes entries off our list, remembering them as closed. */
function takeEntries(from: number): Entry[] {
  const taken = entries.splice(from);
  for (const entry of taken) if (entry.key) closedKeys.add(entry.key);
  return taken;
}

/**
 * Whether a Back that landed below our top entry landed directly below the
 * lowest overlay it closes, rather than going further back (several entries
 * at once, to an older visit of the page). Without the Navigation API, a
 * landing on the same path counts.
 */
function landedBelow(at: number): boolean {
  const lowest = entries[at + 1];
  const api = navigationApi();
  const landed = api?.currentEntry?.index;
  const below = lowest?.key ? api?.entries().find((entry) => entry.key === lowest.key)?.index : undefined;
  if (landed !== undefined && below !== undefined) return landed === below - 1;
  return Boolean(lowest) && window.location.pathname === lowest.pathname;
}

/** Whether a closed entry was reached going forward: the Navigation API
 *  says, else an entry pushed after every open overlay's is above them. */
function cameForward(): boolean {
  if (navigationApi()) return lastTraverse > 0;
  const marker = stateMarker();
  const top = entries[entries.length - 1];
  return typeof marker === 'number' && Boolean(top) && marker > top.id;
}

/**
 * Whether a popstate only closed overlays or took their entries off, rather
 * than going to another view. Worked out from the state before this module
 * handles the event, so any listener can ask, whichever runs first.
 */
export function isOverlayPopState(event: Event): boolean {
  let own = ownPopStates.get(event);
  if (own === undefined) {
    if (traversing) {
      // A step past a closed entry is the user's own Back or Forward, unless
      // it brought them back to the entry they were on.
      const key = navigationApi()?.currentEntry?.key;
      own = stepping === 0 || Boolean(key && key === lastFromKey);
    } else if (onClosedEntry()) {
      own = true;
    } else {
      const at = entries.findIndex((entry) => entry.id === stateMarker());
      own = at < entries.length - 1 && landedBelow(at);
    }
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
  // too and copies its own keys over from the entry. Our marker stays: the
  // entry may be a lower overlay's, still open.
  const marker = stateMarker();
  window.history.replaceState(marker === undefined ? { ...state } : { ...state, [MARKER]: marker }, '', href);
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

/** Leaves a closed entry at once: the router and the page never see the
 *  landing, so a URL-driven sheet (Prowlarr's ?indexer=) doesn't reopen. */
function leaveClosedEntry(event: Event, direction: 1 | -1) {
  event.stopImmediatePropagation();
  stepPastClosed(direction);
}

function onPopState(event: PopStateEvent) {
  isOverlayPopState(event);
  if (traversing) {
    if (stepping) {
      if (onClosedEntry()) return leaveClosedEntry(event, stepping);
    } else if (keep) {
      keepOnEntry(keep.href, keep.state);
      keep = null;
    }
    settleSoon();
    return;
  }
  const closedEntry = onClosedEntry();
  // Forward onto the entry of an overlay Back closed (the picker, with the
  // Filters sheet under it still open): step on, closing nothing.
  if (closedEntry && cameForward()) return leaveClosedEntry(event, 1);
  const at = entries.findIndex((entry) => entry.id === stateMarker());
  if (at < entries.length - 1) {
    // Back from the user: close every overlay above the entry it landed on,
    // the top one for a single Back.
    const top = entries[entries.length - 1];
    // The URL the page had under the overlay, which it may have rewritten.
    // Only for a Back to the entry right below it: one further back is an
    // older visit, with its own URL.
    const left = top.key ? navigationApi()?.entries().find((entry) => entry.key === top.key)?.url : null;
    if (!closedEntry && left && new URL(left).pathname === window.location.pathname && landedBelow(at)) {
      keepOnEntry(left, pageState(currentState()));
    }
    closing.push(...takeEntries(at + 1).reverse());
    traversing = true;
    if (closedEntry) return leaveClosedEntry(event, -1);
    settleSoon();
    return;
  }
  if (closedEntry) leaveClosedEntry(event, -1);
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
      takeEntries(entries.length - closed);
      // Something else pushed over them: leave history alone rather than
      // send the user back from where they went.
      if (current) goBack(closed);
    });
  });
}

function listen() {
  if (listening) return;
  listening = true;
  // Listeners run in the order they were added, capture or not, and this
  // one has to see a Back before the router's (added in its first effect) and
  // the page's: to leave a closed entry before they render it, and to put a
  // kept URL back before they read it. So it is added when this module
  // loads, which the root layout makes happen during the first render (see
  // OverlayHistoryListener).
  window.addEventListener('popstate', onPopState);
  const api = navigationApi();
  if (!api) return;
  const listener = (event: Event) => {
    const { navigationType, destination } = event as Event & { navigationType?: string; destination?: { index: number } };
    // The user's own Back or Forward, not one of ours.
    if (traversing || navigationType !== 'traverse' || !destination || !api.currentEntry) return;
    lastTraverse = destination.index - api.currentEntry.index;
    lastFromKey = api.currentEntry.key;
  };
  api.addEventListener('navigate', listener);
  navigateListener = { api, listener };
}

if (typeof window !== 'undefined') listen();

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
    if (entry.key) closedKeys.delete(entry.key);
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
    const taken = takeEntries(0).reverse();
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
  if (listening) window.removeEventListener('popstate', onPopState);
  navigateListener?.api.removeEventListener('navigate', navigateListener.listener);
  navigateListener = null;
  listening = false;
  closedKeys.clear();
  lastFromKey = null;
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
