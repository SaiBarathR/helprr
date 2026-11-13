'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Command, CommandInput, CommandList } from '@/components/ui/command';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-is-mobile';

/**
 * A long list to pick one from, with a search field: a popover from md up and,
 * below md, the app's bottom sheet. In a phone popover the search field took
 * focus at once, the keyboard opened, and iOS scrolled the page to show the
 * field, carrying the popover to the top of the screen. The sheet opens with
 * the keyboard down and stays above it once the search field is tapped.
 * Children are the list's Command parts (CommandEmpty, CommandGroup…).
 */
export function ResponsiveCombobox({ open, onOpenChange, trigger, title, searchPlaceholder, align = 'start', selectedValue, children }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** One element; it becomes the trigger. */
  trigger: ReactNode;
  /** The sheet's heading on a phone. */
  title: string;
  searchPlaceholder: string;
  /** Where the popover lines up with its trigger. */
  align?: 'start' | 'center' | 'end';
  /**
   * The CommandItem `value` of the current pick. The list starts highlighted
   * there; without it cmdk highlights the first row, grey on "Same as the
   * server" while the tick sat on the chosen zone.
   */
  selectedValue?: string;
  children: ReactNode;
}) {
  // Tailwind's md starts at 768px, so "below md" is up to 767px.
  const isPhone = useIsMobile(767);

  // Each new search starts at the top of the list. On the first key cmdk
  // scrolled to the row still highlighted, the current pick, already sorted
  // ~30 rows down, then moved the highlight to the new best match without
  // scrolling back ("Lon" left Europe/London above the view). cmdk only hears
  // the search in the input's effect and scrolls in a later render, so the
  // reset waits a frame to come after it.
  const [search, setSearch] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      if (listRef.current) listRef.current.scrollTop = 0;
    });
    return () => cancelAnimationFrame(frame);
  }, [search]);
  // Opened again: unfiltered, on the current pick. Cleared on open, not on
  // close, so a closing sheet doesn't snap back to the full list as it leaves.
  const [wasOpen, setWasOpen] = useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) setSearch('');
  }

  if (isPhone) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          {/* Rows as tall as the other phone sheets' (44px). */}
          <Command defaultValue={selectedValue} className="min-h-0 flex-1 bg-transparent **:data-[slot=command-item]:min-h-11 **:data-[slot=command-item]:px-3">
            <div className="shrink-0 px-2">
              <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
            </div>
            {/* overflow-anchor: Chrome keeps the row that was in view where it was as
                search re-sorts the list, which scrolled the best match out of sight
                ("Lon" hid Europe/London). */}
            <CommandList ref={listRef} className="max-h-none min-h-0 flex-1 overscroll-contain px-2 pb-2 [overflow-anchor:none]">{children}</CommandList>
          </Command>
          <div className="shrink-0 border-t border-border px-2 py-2">
            <DrawerClose asChild>
              <Button className="w-full">Done</Button>
            </DrawerClose>
          </div>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{trigger}</PopoverTrigger>
      <PopoverContent className="p-0 w-[280px]" align={align}>
        <Command defaultValue={selectedValue}>
          <CommandInput placeholder={searchPlaceholder} value={search} onValueChange={setSearch} />
          <CommandList ref={listRef} className="[overflow-anchor:none]">{children}</CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
