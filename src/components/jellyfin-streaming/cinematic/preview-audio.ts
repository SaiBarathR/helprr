'use client';

import { useSyncExternalStore } from 'react';

/**
 * Whether hover previews play with sound.
 *
 * Shared rather than per-card because that is how the site behaves: turning
 * audio on for one preview keeps it on as you move down the row. Card-local
 * state would silently re-mute on every new tile.
 *
 * Only the card currently holding the preview slot subscribes — the control
 * mounts with the playing preview and unmounts with it — so this adds no hook
 * to the hundreds of cards that are merely on screen.
 */
let muted = true;
const listeners = new Set<() => void>();

export function setPreviewMuted(next: boolean): void {
  if (muted === next) return;
  muted = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function usePreviewMuted(): boolean {
  return useSyncExternalStore(subscribe, () => muted, () => true);
}
