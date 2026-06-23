'use client';

import { useCallback, useId, useMemo, useState } from 'react';

interface UseSearchHistoryListboxOptions {
  items: string[];
  open: boolean;
  onSelect: (term: string) => void;
  onClose: () => void;
}

export function useSearchHistoryListbox({
  items,
  open,
  onSelect,
  onClose,
}: UseSearchHistoryListboxOptions) {
  const listboxId = useId();
  const itemsToken = useMemo(() => `${open}:${items.join('\0')}`, [open, items]);
  const [highlightState, setHighlightState] = useState({ token: itemsToken, index: -1 });

  const highlightedIndex =
    highlightState.token === itemsToken ? highlightState.index : -1;

  const setHighlightedIndex = useCallback(
    (index: number | ((current: number) => number)) => {
      setHighlightState((prev) => {
        const current = prev.token === itemsToken ? prev.index : -1;
        const next = typeof index === 'function' ? index(current) : index;
        return { token: itemsToken, index: next };
      });
    },
    [itemsToken]
  );

  const getOptionId = useCallback(
    (index: number) => `${listboxId}-option-${index}`,
    [listboxId]
  );

  const activeDescendantId =
    open && highlightedIndex >= 0 && highlightedIndex < items.length
      ? getOptionId(highlightedIndex)
      : undefined;

  const onInputKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }

      if (!open || items.length === 0) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.min(i + 1, items.length - 1));
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlightedIndex((i) => Math.max(i - 1, -1));
      } else if (e.key === 'Enter' && highlightedIndex >= 0) {
        e.preventDefault();
        onSelect(items[highlightedIndex]);
      }
    },
    [open, items, highlightedIndex, onSelect, onClose, setHighlightedIndex]
  );

  return {
    listboxId,
    highlightedIndex,
    setHighlightedIndex,
    getOptionId,
    activeDescendantId,
    onInputKeyDown,
  };
}
