'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { Check } from 'lucide-react';
import Link from '@/components/ui/app-link';
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
// Set when a pick should also close the menu: a single list of one-choice options.
const CloseOnPick = createContext<(() => void) | null>(null);
// Set in an action sheet, where every row runs its action and closes the sheet.
const CloseOnAction = createContext<(() => void) | null>(null);

// One drawer row: 44px tall, as the dropdown's items are on a phone.
const DRAWER_ROW = 'flex min-h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm transition-colors hover:bg-accent active:bg-accent/80';

/**
 * A long menu: a dropdown from md up, and below md the app's bottom drawer, so
 * a phone gets a titled sheet it can scroll instead of a popover taller than
 * the screen. Build its body from the ResponsiveMenu* parts below.
 */
export function ResponsiveMenu({ trigger, title, titleInDropdown, align = 'start', closeOnPick, actions, open, onOpenChange, contentClassName, footer, children }: {
  /** One element; it becomes the trigger. */
  trigger: ReactNode;
  /** The drawer's heading. */
  title: string;
  /** Also head the dropdown with the title. */
  titleInDropdown?: boolean;
  /** Where the dropdown lines up with its trigger. */
  align?: 'start' | 'center' | 'end';
  /**
   * A single list of one-choice options (a sort, an instance): a pick applies
   * and closes. Menus with several sections or multi-select stay open for Done.
   */
  closeOnPick?: boolean;
  /**
   * An action sheet: every row runs its action and closes the menu, and the
   * phone sheet ends with Cancel (iOS) instead of the settings sheets' Done.
   */
  actions?: boolean;
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
  // Open state is held here unless the caller controls it, so a pick can close the menu.
  const [ownOpen, setOwnOpen] = useState(false);
  const isOpen = open ?? ownOpen;
  const setOpen = (next: boolean) => {
    if (open === undefined) setOwnOpen(next);
    onOpenChange?.(next);
  };
  const close = closeOnPick ? () => setOpen(false) : null;
  const closeOnAction = actions ? () => setOpen(false) : null;

  if (isPhone) {
    return (
      <Drawer open={isOpen} onOpenChange={setOpen}>
        <DrawerTrigger asChild>{trigger}</DrawerTrigger>
        {/* A short menu hugs its rows; a long one still stops at the base drawer's 90dvh and scrolls. */}
        <DrawerContent className="data-[vaul-drawer-direction=bottom]:h-auto">
          <DrawerHeader>
            <DrawerTitle>{title}</DrawerTitle>
          </DrawerHeader>
          <InDrawer.Provider value>
            <DrawerBody>
              <CloseOnPick.Provider value={close}>
                <CloseOnAction.Provider value={closeOnAction}>{children}</CloseOnAction.Provider>
              </CloseOnPick.Provider>
            </DrawerBody>
            <div className="shrink-0 border-t border-border px-2 py-2">
              {footer ?? (
                <DrawerClose asChild>
                  {actions ? (
                    <Button variant="outline" className="w-full">Cancel</Button>
                  ) : (
                    <Button className="w-full">Done</Button>
                  )}
                </DrawerClose>
              )}
            </div>
          </InDrawer.Provider>
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <DropdownMenu open={isOpen} onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align={align} className={contentClassName}>
        {titleInDropdown && (
          <>
            <DropdownMenuLabel>{title}</DropdownMenuLabel>
            <DropdownMenuSeparator />
          </>
        )}
        <CloseOnPick.Provider value={close}>{children}</CloseOnPick.Provider>
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

/** A choice; the menu stays open to pick others unless it closes on a pick. */
export function ResponsiveMenuCheckboxItem({ checked, onCheckedChange, ariaLabel, children }: {
  checked: boolean;
  onCheckedChange: () => void;
  ariaLabel?: string;
  children: ReactNode;
}) {
  const inDrawer = useContext(InDrawer);
  const close = useContext(CloseOnPick);
  if (inDrawer) {
    return (
      <button
        type="button"
        aria-pressed={checked}
        aria-label={ariaLabel}
        onClick={() => {
          onCheckedChange();
          close?.();
        }}
        className={cn(DRAWER_ROW, checked && 'font-medium text-primary')}
      >
        <span className="flex min-w-0 flex-1 items-center gap-2">{children}</span>
        {checked && <Check className="h-4 w-4 shrink-0" />}
      </button>
    );
  }
  return (
    <DropdownMenuCheckboxItem
      checked={checked}
      aria-label={ariaLabel}
      onCheckedChange={onCheckedChange}
      // The dropdown closes itself on a pick unless told not to.
      onSelect={close ? undefined : (event) => event.preventDefault()}
    >
      {children}
    </DropdownMenuCheckboxItem>
  );
}

/** A one-off action, such as Reset filters; in an action sheet it also closes the menu. */
export function ResponsiveMenuActionItem({ onSelect, disabled, destructive, children }: {
  onSelect: () => void;
  disabled?: boolean;
  /** A delete or remove: red text. */
  destructive?: boolean;
  children: ReactNode;
}) {
  const inDrawer = useContext(InDrawer);
  const closeOnAction = useContext(CloseOnAction);
  if (inDrawer) {
    return (
      <button
        type="button"
        disabled={disabled}
        onClick={() => {
          // Close first, so a dialog the action opens isn't stacked under the sheet.
          closeOnAction?.();
          onSelect();
        }}
        className={cn(DRAWER_ROW, 'disabled:pointer-events-none disabled:opacity-50', destructive && 'text-destructive')}
      >
        {children}
      </button>
    );
  }
  return (
    <DropdownMenuItem onClick={onSelect} disabled={disabled} variant={destructive ? 'destructive' : 'default'}>
      {children}
    </DropdownMenuItem>
  );
}

/** A link row: an in-app page, or with `external` a new tab. In an action sheet it closes the menu. */
export function ResponsiveMenuLinkItem({ href, external, children }: {
  href: string;
  external?: boolean;
  children: ReactNode;
}) {
  const inDrawer = useContext(InDrawer);
  const closeOnAction = useContext(CloseOnAction);
  const link = external ? (
    <a href={href} target="_blank" rel="noopener noreferrer" onClick={inDrawer ? closeOnAction ?? undefined : undefined} className={inDrawer ? DRAWER_ROW : undefined}>
      {children}
    </a>
  ) : (
    <Link href={href} onClick={inDrawer ? closeOnAction ?? undefined : undefined} className={inDrawer ? DRAWER_ROW : undefined}>
      {children}
    </Link>
  );
  if (inDrawer) return link;
  return <DropdownMenuItem asChild>{link}</DropdownMenuItem>;
}

/**
 * Ascending/Descending as one compact segmented control, placed at the top of
 * a sort menu. Picking a direction applies it and, in a menu that closes on a
 * pick, closes it like a sort option does.
 */
export function ResponsiveMenuSortDirection({ value, onChange }: {
  value: 'asc' | 'desc';
  onChange: (direction: 'asc' | 'desc') => void;
}) {
  const inDrawer = useContext(InDrawer);
  const close = useContext(CloseOnPick);
  const segment = (selected: boolean) => cn(
    'relative flex h-8 items-center justify-center rounded-md border border-transparent px-2 text-xs font-medium transition-colors',
    selected
      ? 'bg-background text-foreground shadow-sm dark:border-input dark:bg-input/30'
      : 'text-muted-foreground hover:text-foreground',
  );
  const options = [['asc', 'Ascending'], ['desc', 'Descending']] as const;
  if (inDrawer) {
    return (
      <div role="group" aria-label="Sort direction" className="mx-1 mb-2 grid grid-cols-2 gap-0.5 rounded-lg bg-muted/50 p-0.5">
        {options.map(([direction, label]) => (
          <button
            key={direction}
            type="button"
            aria-pressed={value === direction}
            onClick={() => {
              onChange(direction);
              close?.();
            }}
            // A 44px-tall hit area; the width stays, since the two sit edge to edge.
            className={cn(segment(value === direction), 'touch-target-y')}
          >
            {label}
          </button>
        ))}
      </div>
    );
  }
  return (
    <div role="group" aria-label="Sort direction" className="m-1 grid grid-cols-2 gap-0.5 rounded-lg bg-muted/50 p-0.5">
      {options.map(([direction, label]) => (
        <DropdownMenuItem
          key={direction}
          aria-checked={value === direction}
          role="menuitemradio"
          onSelect={(event) => {
            onChange(direction);
            // The dropdown closes itself on a pick unless told not to.
            if (!close) event.preventDefault();
          }}
          className={cn(segment(value === direction), 'py-0 focus:bg-accent/60')}
        >
          {label}
        </DropdownMenuItem>
      ))}
    </div>
  );
}

/** A row that is its own element, such as a link; in the dropdown it is a menu item. */
export function ResponsiveMenuItem({ children }: { children: ReactNode }) {
  if (useContext(InDrawer)) return children;
  return <DropdownMenuItem asChild>{children}</DropdownMenuItem>;
}
