'use client';

import { useCallback, useEffect, useState } from 'react';

/** Retain only the sheet's geometry during exit, never remount the video. */
export function usePlayerSheet(open: boolean) {
  const [state, setState] = useState({ open, present: open });
  if (state.open !== open) {
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setState({ open, present: open || (state.present && !reduce) });
  }

  const finishExit = useCallback(() => {
    setState((current) => current.open || !current.present
      ? current : { open: false, present: false });
  }, []);

  useEffect(() => {
    if (open || !state.present) return;
    // animationend normally finishes the 160ms exit. A cancelled animation or
    // a preference change must not leave an invisible sheet over the page.
    const timer = window.setTimeout(finishExit, 220);
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => { if (motion.matches) finishExit(); };
    motion.addEventListener('change', onChange);
    return () => {
      window.clearTimeout(timer);
      motion.removeEventListener('change', onChange);
    };
  }, [open, state.present, finishExit]);

  return { present: open || state.present, exiting: !open && state.present, finishExit };
}
