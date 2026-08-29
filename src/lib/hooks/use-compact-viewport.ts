'use client';

import { useEffect, useState } from 'react';

/** Below Tailwind's `md`, which is where the cinematic skin switches layouts. */
const COMPACT_QUERY = '(max-width: 767.98px)';

/**
 * True on phone-width viewports.
 *
 * The cinematic skin is not one layout that reflows — the phone version of a
 * streaming home is a different composition: a portrait hero card instead of a
 * wide billboard, portrait rails instead of 16:9 ones, chips instead of a text
 * nav. Those choices pick different *artwork* per item, so they cannot be made
 * in CSS; the component has to know.
 *
 * Starts false so the server and the first client render agree, then corrects.
 */
export function useCompactViewport(): boolean {
  const [compact, setCompact] = useState(false);

  useEffect(() => {
    const query = window.matchMedia(COMPACT_QUERY);
    const sync = () => setCompact(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  return compact;
}
