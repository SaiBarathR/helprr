'use client';

import { createPortal } from 'react-dom';
import { cn } from '@/lib/utils';

/**
 * A card of actions floating at the foot of the viewport — unsaved changes,
 * bulk actions on a selection. Render it only while it's needed.
 *
 * It sits above the bottom tab bar and the home indicator (`--footer-height`)
 * and beside the sidebar (`--app-main-left`), and leaves a spacer where it's
 * rendered so it never covers the page's last row. The card is portalled to <body> so `position: fixed` is relative to the
 * viewport: an ancestor with a transform (the page entry animation) or a
 * backdrop filter would otherwise pin it inside that ancestor.
 */
export function FloatingActionBar({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <>
      <div aria-hidden className="h-24" />
      {typeof document !== 'undefined' && createPortal(
        <div data-floating-action-bar className="pointer-events-none fixed right-0 left-[var(--app-main-left,0px)] bottom-[calc(var(--footer-height)+var(--player-bar-height,0px)+0.5rem)] z-40 pl-[calc(0.5rem+var(--main-inset-left))] pr-[calc(0.5rem+var(--main-inset-right))] md:bottom-[calc(var(--footer-height)+var(--player-bar-height,0px)+0.75rem)] md:pl-[calc(1.5rem+var(--main-inset-left))] md:pr-[calc(1.5rem+var(--main-inset-right))]">
          <div
            className={cn(
              'pointer-events-auto mx-auto flex max-w-3xl items-center gap-2 rounded-xl border app-chrome-bar bg-background/95 px-3 py-2 shadow-lg backdrop-blur supports-[backdrop-filter]:bg-background/80',
              className,
            )}
          >
            {children}
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
