'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';

/**
 * A single global claim on "the card currently allowed to stream a preview".
 *
 * Rail previews are the one place this could get expensive: a row holds a
 * dozen cards, and a self-hosted server may transcode for each one. Without a
 * single slot, dragging the pointer across a row would start — and leave
 * running — a stream per card. One claim means at most one preview exists at
 * any moment, and taking the claim revokes the previous holder, which tears
 * its stream down through the normal cleanup path.
 */
let holder: string | null = null;
const listeners = new Set<() => void>();

function notify(): void {
  listeners.forEach((listener) => listener());
}

function claim(id: string): void {
  if (holder === id) return;
  holder = id;
  notify();
}

function release(id: string): void {
  if (holder !== id) return;
  holder = null;
  notify();
}

/**
 * True while `id` holds the slot. Claims it when `wanted` turns true.
 *
 * `id` must identify the *card*, not the title: the same item legitimately
 * appears in several rails (Continue watching and Next up share episodes), and
 * keying on the item let every copy of it hold the slot at once — which is
 * exactly the multiple-streams case the slot exists to prevent.
 */
export function useHoverPreviewSlot(id: string, wanted: boolean): boolean {
  const [held, setHeld] = useState(false);

  useEffect(() => {
    const sync = () => setHeld(holder === id);
    listeners.add(sync);
    sync();
    return () => {
      listeners.delete(sync);
    };
  }, [id]);

  useEffect(() => {
    if (wanted) claim(id);
    else release(id);
    return () => release(id);
  }, [id, wanted]);

  return held;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** True while any card is previewing, so the billboard can stand down. */
export function useHoverPreviewActive(): boolean {
  return useSyncExternalStore(subscribe, () => holder !== null, () => false);
}
