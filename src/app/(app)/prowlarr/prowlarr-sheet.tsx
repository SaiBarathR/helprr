'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from '@/components/ui/drawer';
import { useIsMobile } from '@/hooks/use-is-mobile';
import { cn } from '@/lib/utils';

const InDialog = createContext(false);

/**
 * The Prowlarr page's indexer, app and Add sheets: a bottom drawer on phones, a
 * centred dialog from the width Search options and Send switch at, so a short
 * form isn't stretched across a tablet or desktop. Put the content in
 * ProwlarrSheetBody and any buttons in ProwlarrSheetFooter.
 */
export function ProwlarrSheet({
  open,
  onClose,
  title,
  description,
  autoFocus,
  size,
  scrollTogether,
  children,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  description: ReactNode;
  /** The phone drawer's (vaul's autoFocus); the dialog always focuses its first control. */
  autoFocus?: boolean;
  /** The phone drawer's height (see DrawerContent). */
  size?: 'full' | 'content';
  /** For a form: see DrawerContent. */
  scrollTogether?: boolean;
  children: ReactNode;
}) {
  const isMobile = useIsMobile();
  const onOpenChange = (next: boolean) => { if (!next) onClose(); };

  if (isMobile) {
    return (
      <Drawer open={open} autoFocus={autoFocus} onOpenChange={onOpenChange}>
        <DrawerContent size={size} scrollTogether={scrollTogether}>
          <DrawerHeader>
            <DrawerTitle className="text-base leading-snug">{title}</DrawerTitle>
            <DrawerDescription>{description}</DrawerDescription>
          </DrawerHeader>
          {children}
        </DrawerContent>
      </Drawer>
    );
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* A column, so a long body scrolls between the header and the buttons. */}
      <DialogContent className="flex flex-col overflow-hidden sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-base leading-snug [overflow-wrap:anywhere]">{title}</DialogTitle>
          <DialogDescription className="[overflow-wrap:anywhere]">{description}</DialogDescription>
        </DialogHeader>
        <InDialog.Provider value>{children}</InDialog.Provider>
      </DialogContent>
    </Dialog>
  );
}

export function ProwlarrSheetBody({ className, children }: { className?: string; children: ReactNode }) {
  const inDialog = useContext(InDialog);
  return (
    <div
      className={cn(
        'min-h-0 flex-1 overflow-y-auto',
        // In a drawer, more room below when nothing follows, clear of the home indicator.
        inDialog ? '-mx-6 px-6' : 'px-4 pb-4 last:pb-8',
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ProwlarrSheetFooter({ children }: { children: ReactNode }) {
  return useContext(InDialog)
    ? <DialogFooter>{children}</DialogFooter>
    : <DrawerFooter className="border-t">{children}</DrawerFooter>;
}
