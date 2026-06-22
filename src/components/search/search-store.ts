'use client';

import { create } from 'zustand';

// Open-state for the global search palette. Deliberately NOT persisted (unlike the
// UI store) — it's transient session state any trigger (sidebar button, mobile FAB,
// ⌘K) can flip.
interface SearchPaletteState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useSearchPalette = create<SearchPaletteState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
