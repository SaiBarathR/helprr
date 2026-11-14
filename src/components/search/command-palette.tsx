'use client';

import dynamic from 'next/dynamic';
import { useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import { useSearchPalette } from '@/components/search/search-store';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

export function SearchLoadingDialog() {
  const open = useSearchPalette((state) => state.open);
  const setOpen = useSearchPalette((state) => state.setOpen);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent keyboardAnchorTop="12%" className="top-[12%] translate-y-0 sm:max-w-xl">
        <DialogTitle>Search</DialogTitle>
        <DialogDescription role="status" className="flex items-center gap-2">
          <Loader2 className="size-4 animate-spin" /> Loading search…
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

const CommandPaletteDialog = dynamic(
  () => import('@/components/search/command-palette-dialog')
    .then((module) => module.CommandPaletteDialog),
  { ssr: false, loading: SearchLoadingDialog },
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

  return open ? <CommandPaletteDialog /> : null;
}
