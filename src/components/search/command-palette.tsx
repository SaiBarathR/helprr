'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { Search } from 'lucide-react';
import { useSearchPalette } from '@/components/search/search-store';

const CommandPaletteDialog = dynamic(
  () => import('@/components/search/command-palette-dialog')
    .then((module) => module.CommandPaletteDialog),
  { ssr: false },
);

export function CommandPalette() {
  const open = useSearchPalette((state) => state.open);
  const setOpen = useSearchPalette((state) => state.setOpen);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(!useSearchPalette.getState().open);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [setOpen]);

  return (
    <>
      {open ? <CommandPaletteDialog /> : null}
      <button
        type="button"
        aria-label="Search"
        onClick={() => setOpen(true)}
        className="md:hidden fixed right-0 bottom-[22%] z-40 flex h-16 w-9 items-center justify-start rounded-l-xl bg-primary pl-2 text-primary-foreground shadow-lg translate-x-[45%] active:translate-x-0 transition-transform"
      >
        <Search className="size-4" />
      </button>
    </>
  );
}
