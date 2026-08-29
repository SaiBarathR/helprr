'use client';

import { useCallback, useRef, useState } from 'react';

/**
 * My List, optimistically.
 *
 * Each caller only ever knows its own item, so this keeps local state and
 * reconciles on failure rather than reaching for the query cache — a rail can
 * hold the same title twice (Continue watching and Next up share episodes) and
 * the two copies are allowed to disagree until the next fetch.
 */
export function useFavoriteToggle(itemId: string, initial: boolean) {
  const [isFavorite, setIsFavorite] = useState(initial);
  const inFlight = useRef(false);

  const toggle = useCallback(() => {
    if (inFlight.current) return;
    const next = !isFavorite;
    inFlight.current = true;
    setIsFavorite(next);
    void fetch('/api/jellyfin/catalog/favorite', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ itemId, favorite: next }),
    })
      .then((response) => { if (!response.ok) setIsFavorite(!next); })
      .catch(() => setIsFavorite(!next))
      .finally(() => { inFlight.current = false; });
  }, [itemId, isFavorite]);

  return { isFavorite, toggle };
}
