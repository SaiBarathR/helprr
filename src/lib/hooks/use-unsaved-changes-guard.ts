'use client';

import { useEffect, useState } from 'react';
import { canGoBackInApp, useAppRouter } from '@/components/layout/navigation-provider';
import { useBackGuard } from '@/lib/overlay-history';

/**
 * Warn before the browser discards unsaved edits: registers a `beforeunload`
 * prompt while `dirty` is true (reload, tab close, external navigation).
 *
 * In-app navigation has no App Router route-change event, so pages must also
 * guard their own links/buttons — `useLeaveConfirm` does that for the page's
 * back link and for the system Back.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome requires returnValue to be set for the prompt to appear.
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [dirty]);
}

/**
 * The page's "Discard unsaved changes?" confirm, asked by its own back link
 * (`leave`) and by the system Back (the browser's, Android's, an iOS swipe)
 * while `dirty`. Spread `dialog` onto the page's ConfirmDialog.
 *
 * Confirming goes where the press was going: `href` for the link, one step
 * back for the system Back (so the user presses Back once). Cancelling keeps
 * the edits and the history as they were.
 *
 * The confirm that Back opens holds no history entry of its own, so a second
 * Back while it is up leaves the page. Chrome's Back button skips an entry
 * whose page pushed the next one without a user gesture (its history
 * manipulation intervention), and an entry pushed in answer to Back has none:
 * Back on the confirm skipped the page and closed the tab instead. That holds
 * at the start of history too, where Discard goes to `href`.
 *
 * A CloseWatcher would let Android's second Back close the confirm instead,
 * but putting the guard entry back afterwards is again a push with no user
 * gesture, so the Back after that would skip the page: it would only move the
 * silent leave one Back later.
 */
export function useLeaveConfirm(dirty: boolean, href: string) {
  const router = useAppRouter();
  // Who asked (Back holds no entry for the confirm, the link's does), and
  // whether Discard steps back or goes to `href`: at the start of history
  // (the page opened directly) a confirmed Back has no step back to take.
  const [asking, setAsking] = useState<{ byBack: boolean; stepBack: boolean } | null>(null);
  const [leaving, setLeaving] = useState(false);
  useBackGuard(dirty && asking === null && !leaving, () => setAsking({ byBack: true, stepBack: canGoBackInApp() }));

  return {
    leave: () => (dirty ? setAsking({ byBack: false, stepBack: false }) : router.push(href)),
    dialog: {
      open: asking !== null,
      closeOnBack: !asking?.byBack,
      onOpenChange: (open: boolean) => {
        if (!open) setAsking(null);
      },
      onConfirm: () => {
        setLeaving(true);
        if (asking?.stepBack) router.back();
        else router.push(href);
      },
    },
  };
}
