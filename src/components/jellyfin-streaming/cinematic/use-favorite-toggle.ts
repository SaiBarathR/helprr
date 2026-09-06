'use client';

import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

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
  const queryClient = useQueryClient();

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
      .then((response) => {
        if (!response.ok) { setIsFavorite(!next); return; }
        // The title's own detail payload carries UserData.IsFavorite, and both
        // the overlay and the detail page seed their control from it. Left
        // alone the cache keeps the pre-toggle value, so re-opening a title
        // just added to My List offered to add it again. Only this item's
        // query is dropped — the rails carry the flag too, but they hold their
        // own optimistic copy and refetching every row on a toggle would cost
        // far more than it fixes.
        void queryClient.invalidateQueries({ queryKey: ['jellyfin', 'catalog', 'item', itemId] });
      })
      .catch(() => setIsFavorite(!next))
      .finally(() => { inFlight.current = false; });
  }, [itemId, isFavorite, queryClient]);

  return { isFavorite, toggle };
}
