'use client';

import { useSyncExternalStore } from 'react';
import { Hand, X } from 'lucide-react';
import { useUIStore } from '@/lib/store';
import { cn } from '@/lib/utils';

export type GestureTipId = 'long-press' | 'notification-swipe';

const TIP_TEXT: Record<GestureTipId, string> = {
  'long-press': 'Press and hold a title for quick actions.',
  'notification-swipe': 'Swipe a notification right to mark it read, or left to delete it.',
};

// Both gestures are touch-only, so fine-pointer (desktop) users never see the tips.
const COARSE_POINTER_QUERY = '(pointer: coarse)';

function subscribeCoarsePointer(onChange: () => void) {
  const query = window.matchMedia?.(COARSE_POINTER_QUERY);
  query?.addEventListener?.('change', onChange);
  return () => query?.removeEventListener?.('change', onChange);
}
const getCoarsePointer = () => window.matchMedia?.(COARSE_POINTER_QUERY).matches ?? false;
const getServerCoarsePointer = () => false;

/** Whether the tip should show: a touch device, and not yet closed (after the store loads). */
export function useGestureTipVisible(id: GestureTipId): boolean {
  const coarse = useSyncExternalStore(subscribeCoarsePointer, getCoarsePointer, getServerCoarsePointer);
  const hydrated = useUIStore((s) => s.hasHydrated);
  const dismissed = useUIStore((s) => s.dismissedTips.includes(id));
  return coarse && hydrated && !dismissed;
}

/** One-time hint for a touch gesture; closing it hides it for good on this device. */
export function GestureTip({ id, className }: { id: GestureTipId; className?: string }) {
  const visible = useGestureTipVisible(id);
  const dismissTip = useUIStore((s) => s.dismissTip);
  if (!visible) return null;

  return (
    <div
      role="note"
      className={cn(
        'flex items-center gap-2.5 rounded-xl border border-primary/20 bg-primary/[0.04] pl-3 text-xs text-muted-foreground',
        className,
      )}
    >
      <Hand className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
      <p className="min-w-0 flex-1 py-2">
        <span className="font-medium text-foreground">Tip: </span>
        {TIP_TEXT[id]}
      </p>
      <button
        type="button"
        onClick={() => dismissTip(id)}
        className="flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center text-muted-foreground hover:text-foreground"
        aria-label="Dismiss tip"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
