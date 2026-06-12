'use client';

import { useCallback, useState } from 'react';

// Ephemeral multi-select state for the library list pages. Keys are composite
// `${instanceId}:${id}` strings (matching the React keys the lists already use) so
// numeric ids that collide across instances stay distinct. Not persisted — selection
// is cleared on exit and when the page unmounts.
export interface BulkSelection {
  selectionMode: boolean;
  selectedKeys: Set<string>;
  count: number;
  toggle: (key: string) => void;
  /** Add every given key to the selection (used by "select all [filtered]"). */
  selectMany: (keys: string[]) => void;
  /** Remove only the given keys (the inverse of selectMany, for "deselect all [filtered]"). */
  deselectMany: (keys: string[]) => void;
  clear: () => void;
  enter: () => void;
  /** Leave selection mode and drop any selection. */
  exit: () => void;
}

export function useBulkSelection(): BulkSelection {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());

  const toggle = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const selectMany = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.add(key);
      return next;
    });
  }, []);

  const deselectMany = useCallback((keys: string[]) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      for (const key of keys) next.delete(key);
      return next;
    });
  }, []);

  const clear = useCallback(() => setSelectedKeys(new Set()), []);
  const enter = useCallback(() => setSelectionMode(true), []);
  const exit = useCallback(() => {
    setSelectionMode(false);
    setSelectedKeys(new Set());
  }, []);

  return {
    selectionMode,
    selectedKeys,
    count: selectedKeys.size,
    toggle,
    selectMany,
    deselectMany,
    clear,
    enter,
    exit,
  };
}
