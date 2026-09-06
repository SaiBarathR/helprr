'use client';

import { useSyncExternalStore } from 'react';

/** Below Tailwind's `md`, which is where the cinematic skin switches layouts. */
const COMPACT_QUERY = '(max-width: 767.98px)';

let mediaQuery: MediaQueryList | null = null;

function query(): MediaQueryList {
  mediaQuery ??= window.matchMedia(COMPACT_QUERY);
  return mediaQuery;
}

function subscribe(onChange: () => void): () => void {
  const list = query();
  list.addEventListener('change', onChange);
  return () => list.removeEventListener('change', onChange);
}

/**
 * True on phone-width viewports.
 *
 * The cinematic skin is not one layout that reflows — the phone version of a
 * streaming home is a different composition: a portrait hero card instead of a
 * wide billboard, portrait rails instead of 16:9 ones, chips instead of a text
 * nav. Those choices pick different *artwork* per item, so they cannot be made
 * in CSS; the component has to know.
 *
 * Read through `useSyncExternalStore` so the first client render already knows
 * the answer. Held in state and corrected from an effect, every mount painted
 * the wide layout first: on a phone, going back from a title rendered a rail of
 * 16:9 cards, then swapped to portrait once the effect ran — and because the
 * two shapes request *different image URLs*, the wrong artwork stayed on screen
 * for as long as the right artwork took to arrive, which is the half-second of
 * landscape cards the owner saw on the back gesture. The server still renders
 * the wide layout, since it has no viewport to measure; only the client's first
 * paint is fixed.
 */
export function useCompactViewport(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => query().matches,
    () => false,
  );
}
