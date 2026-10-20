'use client';

import { useSyncExternalStore } from 'react';

type Side = 'top' | 'right' | 'bottom' | 'left';
export type CollisionPadding = number | Partial<Record<Side, number>>;
type Insets = Record<Side, number>;

const SIDES: Side[] = ['top', 'right', 'bottom', 'left'];
const NO_INSETS: Insets = { top: 0, right: 0, bottom: 0, left: 0 };

let probe: HTMLDivElement | null = null;
let insets: Insets | null = null;
const subscribers = new Set<() => void>();

function readInsets(): Insets {
  if (!probe?.isConnected) {
    probe = document.createElement('div');
    probe.setAttribute('aria-hidden', 'true');
    probe.setAttribute('data-safe-area-probe', '');
    probe.style.cssText =
      'position:fixed;top:0;left:0;visibility:hidden;pointer-events:none;' +
      'padding:env(safe-area-inset-top,0px) env(safe-area-inset-right,0px) env(safe-area-inset-bottom,0px) env(safe-area-inset-left,0px)';
    document.body.appendChild(probe);
  }
  const style = getComputedStyle(probe);
  return {
    top: parseFloat(style.paddingTop) || 0,
    right: parseFloat(style.paddingRight) || 0,
    bottom: parseFloat(style.paddingBottom) || 0,
    left: parseFloat(style.paddingLeft) || 0,
  };
}

function getSnapshot(): Insets {
  insets ??= readInsets();
  return insets;
}

// One listener for the whole app, however many menus are mounted (every list
// row has one): measure once, then tell every menu if the insets changed.
function refresh() {
  if (document.visibilityState === 'hidden') return;
  const next = readInsets();
  if (insets && SIDES.every((side) => next[side] === insets![side])) return;
  insets = next;
  for (const notify of subscribers) notify();
}

// Rotation fires resize. Coming back to the installed app re-measures too, in
// case the insets were not final when the app first measured them.
const EVENTS = ['resize', 'orientationchange', 'pageshow'] as const;

function subscribe(onChange: () => void): () => void {
  if (subscribers.size === 0) {
    for (const type of EVENTS) window.addEventListener(type, refresh);
    document.addEventListener('visibilitychange', refresh);
  }
  subscribers.add(onChange);
  return () => {
    subscribers.delete(onChange);
    if (subscribers.size === 0) {
      for (const type of EVENTS) window.removeEventListener(type, refresh);
      document.removeEventListener('visibilitychange', refresh);
    }
  };
}

/**
 * Collision padding for floating menus, measured from the safe area instead of
 * the screen edge.
 *
 * The installed iPhone app draws under the status bar and the home indicator
 * (`black-translucent` with `viewport-fit=cover`), so a menu placed by the
 * screen edge alone could open behind them, where its options cannot be seen
 * or tapped. Radix only takes numbers, so the insets are read from CSS at
 * runtime and added to `base` on each side.
 */
export function useSafeAreaPadding(base: CollisionPadding): Insets {
  const safe = useSyncExternalStore(subscribe, getSnapshot, () => NO_INSETS);
  const pad = (side: Side) => (typeof base === 'number' ? base : (base[side] ?? 0)) + safe[side];
  return { top: pad('top'), right: pad('right'), bottom: pad('bottom'), left: pad('left') };
}
