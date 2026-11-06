'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Button } from '@/components/ui/button';
import { Drawer, DrawerClose, DrawerContent, DrawerHeader, DrawerTitle, DrawerTrigger } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

// True inside the phone drawer, where the dropdown's items have no menu to live in.
const InDrawer = createContext(false);

/**
 * A long menu: a dropdown from md up, and below md the app's bottom drawer, so
 * a phone gets a titled sheet it can scroll instead of a popover taller than
 * the screen. Build its body from the ResponsiveMenu* parts below.
 */
export function ResponsiveMenu({ trigger, title, titleInDropdown, open, onOpenChange, contentClassName, footer, children }: {
  /** One element; it becomes the trigger. */
  trigger: ReactNode;
  /** The drawer's heading. */
  title: string;
  /** Also head the dropdown with the title. */
  titleInDropdown?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /** Classes for the dropdown only. */
  contentClassName?: string;
  /** Kept in view under the list; the drawer otherwise ends with Done. */
  footer?: ReactNode;
  children: ReactNode;
}) {
  // Tailwind's md starts at 768px, so "below md" is up to 767px.
  const isPhone = useIsMobile(767);

  if (isPhone) {
    return (
      <Drawer open={open} onOpenChange={onOpenChange}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        <DrawerContent>
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <InDrawer.Provider value>
            <DrawerBody>{children}</DrawerBody>
            <div className="shrink-0 border-t border-border px-2 py-2">
              {footer ?? (
                <DrawerClose asChild>
                  <Button className="w-full">Done</Button>
                </DrawerClose>
              )}
            </div>
          </InDrawer.Provider>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className={contentClassName}>
        {titleInDropdown && (
          <>
            <DropdownMenuLabel>{title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        {children}
        {footer && (
          <>
            <DropdownMenuSeparator />
            {footer}
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// Fades its bottom edge while rows sit below it, so a list that scrolls says so.
function DrawerBody({ children }: { children: ReactNode }) {
  const [body, setBody] = useState<HTMLDivElement | null>(null);
  const [below, setBelow] = useState(false);
  useEffect(() => {
    if (!body) return;
    const update = () => setBelow(body.scrollHeight - body.scrollTop - body.clientHeight > 1);
    const observer = new ResizeObserver(update);
    // The list itself too: rows that load later change only its height.
    observer.observe(body);
    if (body.firstElementChild) observer.observe(body.firstElementChild);
    body.addEventListener('scroll', update, { passive: true });
    return () => {
      observer.disconnect();
      body.removeEventListener('scroll', update);
    };
  }, [body]);
  return (
    <div ref={setBody} className={cn('flex-1 min-h-0 overflow-y-auto overscroll-contain px-2 pb-4', below && 'scroll-fade-y')}>
      <div>{children}</div>
    </div>
  );
}

export function ResponsiveMenuLabel({ children }: { children: ReactNode }) {
  if (useContext(InDrawer)) {
    return <div className="px-3 pt-3 pb-1 text-xs font-medium text-muted-foreground">{children}</div>;
  }
  return <DropdownMenuLabel>{children}</DropdownMenuLabel>;
}

export function ResponsiveMenuSeparator() {
  if (useContext(InDrawer)) return <div role="separator" className="my-1 h-px bg-border" />;
  return <DropdownMenuSeparator />;
}

/** A choice that stays open to pick from others, like a filter or sort. */
export function ResponsiveMenuCheckboxItem({ checked, onCheckedChange, children }: {
  checked: boolean;
  onCheckedChange: () => void;
  children: ReactNode;
}) {
  if (useContext(InDrawer)) {
    return (
      <button
        type="button"
        aria-pressed={checked}
        onClick={onCheckedChange}
        className={cn(
          'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-accent active:bg-accent/80',
          checked && 'font-medium text-primary',
        )}
      >
        <span className="min-w-0 flex-1">{children}</span>
        {checked && <Check className="h-4 w-4 shrink-0" />}
      </button>
    );
  }
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      onCheckedChange={onCheckedChange}
      onSelect={(event) => event.preventDefault()}
    >
      {children}
    </DropdownMenuCheckboxItem>
  );
}

/** A row that is its own element, such as a link; in the dropdown it is a menu item. */
export function ResponsiveMenuItem({ children }: { children: ReactNode }) {
  if (useContext(InDrawer)) return children;
  return <DropdownMenuItem asChild>{children}</DropdownMenuItem>;
}
