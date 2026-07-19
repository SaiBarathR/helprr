'use client';

import { useEffect } from 'react';

/**
 * Warn before the browser discards unsaved edits: registers a `beforeunload`
 * prompt while `dirty` is true (reload, tab close, external navigation).
 *
 * In-app navigation has no App Router route-change event, so pages must also
 * guard their own links/buttons (e.g. open a ConfirmDialog before
 * `router.push`) — this hook only covers what the browser controls.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome requires returnValue to be set for the prompt to appear.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}
