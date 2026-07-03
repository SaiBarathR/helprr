'use client';

import { type ReactNode, type TouchEvent, useCallback, useEffect, useRef, useState } from 'react';
import { haptic } from '@/lib/haptics';
import { cn } from '@/lib/utils';

export interface SwipeAction {
  /** Short label shown under the icon (e.g. "Delete"). */
  label: string;
  icon: ReactNode;
  /** Action zone colors, e.g. 'bg-destructive text-destructive-foreground'. */
  className: string;
  onAction: () => void;
}

interface SwipeRowProps {
  /** Revealed by swiping the row right. */
  leftAction?: SwipeAction;
  /** Revealed by swiping the row left. */
  rightAction?: SwipeAction;
  disabled?: boolean;
  /** Outer wrapper classes (e.g. 'rounded-xl' for card rows). */
  className?: string;
  /**
   * Classes for the sliding content layer. Must produce an opaque background
   * matching the row's surface so the action zone doesn't show through.
   */
  contentClassName?: string;
  children: ReactNode;
}

// Width of a snapped-open action zone; also the reveal threshold.
const ACTION_WIDTH = 80;
// Raw finger travel before we treat the gesture as a horizontal swipe.
const ENGAGE_SLOP = 8;
// Fraction of row width past which release commits the action directly.
const COMMIT_FRACTION = 0.55;

// Only one row may be open at a time — opening (or engaging) a row closes the
// previously open one. Module-level so coordination needs no context provider.
// The owner token identifies which row instance holds the registration.
let openRowOwner: object | null = null;
let openRowClose: (() => void) | null = null;

/**
 * Touch-only swipe-to-act wrapper for list rows. Swiping reveals an action
 * zone; releasing past the reveal threshold snaps it open (tap to fire), and a
 * full swipe past the commit threshold fires the action immediately. Vertical
 * scrolling stays native via `touch-action: pan-y`, so the gesture never has
 * to preventDefault. Touch events only fire on touch input, so desktop
 * (fine-pointer) behavior is untouched. Gesture-only convenience: every action
 * offered here must stay reachable through existing buttons/menus.
 */
export function SwipeRow({ leftAction, rightAction, disabled, className, contentClassName, children }: SwipeRowProps) {
  const contentRef = useRef<HTMLDivElement>(null);
  const leftZoneRef = useRef<HTMLDivElement>(null);
  const rightZoneRef = useRef<HTMLDivElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // Gesture state lives in refs — the finger-following transform is written to
  // the DOM directly so drags never re-render the (potentially heavy) row.
  const startRef = useRef<{ x: number; y: number } | null>(null);
  const engagedRef = useRef(false);
  const abandonedRef = useRef(false);
  const offsetRef = useRef(0);
  const rowWidthRef = useRef(0);
  const pastCommitRef = useRef(false);
  const justSwipedRef = useRef(false);
  const [open, setOpenState] = useState<'left' | 'right' | null>(null);
  const openRef = useRef<'left' | 'right' | null>(null);
  const setOpen = useCallback((v: 'left' | 'right' | null) => {
    openRef.current = v;
    setOpenState(v);
  }, []);

  const reduceMotion = () =>
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  const applyOffset = useCallback((offset: number, animate: boolean) => {
    offsetRef.current = offset;
    const content = contentRef.current;
    if (!content) return;
    const transition = animate && !reduceMotion() ? 'transform 0.25s ease, width 0.25s ease' : 'none';
    content.style.transition = transition;
    content.style.transform = offset === 0 ? '' : `translateX(${offset}px)`;
    for (const [zone, width] of [
      [leftZoneRef.current, Math.max(0, offset)],
      [rightZoneRef.current, Math.max(0, -offset)],
    ] as const) {
      if (!zone) continue;
      zone.style.transition = transition;
      zone.style.width = `${width}px`;
    }
  }, []);

  // Stable identity for this row in the open-row registry.
  const ownerRef = useRef({});

  const close = useCallback(() => {
    applyOffset(0, true);
    if (openRef.current) setOpen(null);
    if (openRowOwner === ownerRef.current) {
      openRowOwner = null;
      openRowClose = null;
    }
  }, [applyOffset, setOpen]);

  // While open, any touch outside the row closes it (mirrors iOS lists).
  useEffect(() => {
    if (!open) return;
    const onDocTouch = (e: globalThis.TouchEvent) => {
      if (rootRef.current && e.target instanceof Node && rootRef.current.contains(e.target)) return;
      close();
    };
    document.addEventListener('touchstart', onDocTouch, { capture: true, passive: true });
    return () => document.removeEventListener('touchstart', onDocTouch, { capture: true });
  }, [open, close]);

  useEffect(() => () => {
    if (openRowOwner === ownerRef.current) {
      openRowOwner = null;
      openRowClose = null;
    }
  }, []);

  const fire = useCallback((action: SwipeAction) => {
    close();
    action.onAction();
  }, [close]);

  const onTouchStart = (e: TouchEvent<HTMLDivElement>) => {
    if (disabled || e.touches.length !== 1) return;
    startRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    engagedRef.current = false;
    abandonedRef.current = false;
    pastCommitRef.current = false;
    rowWidthRef.current = rootRef.current?.offsetWidth ?? 0;
  };

  const onTouchMove = (e: TouchEvent<HTMLDivElement>) => {
    const start = startRef.current;
    if (!start || abandonedRef.current) return;
    const dx = e.touches[0].clientX - start.x;
    const dy = e.touches[0].clientY - start.y;

    if (!engagedRef.current) {
      if (Math.abs(dx) < ENGAGE_SLOP && Math.abs(dy) < ENGAGE_SLOP) return;
      // Mostly-vertical start → this is a scroll; leave the touch alone for
      // the rest of the gesture (the browser owns it via touch-action: pan-y).
      if (Math.abs(dy) > Math.abs(dx) && !openRef.current) {
        abandonedRef.current = true;
        return;
      }
      engagedRef.current = true;
      if (openRowOwner !== ownerRef.current) openRowClose?.();
      openRowOwner = ownerRef.current;
      openRowClose = close;
      justSwipedRef.current = true;
    }

    // Anchor the drag on the current open offset so an open row drags closed
    // naturally, and clamp to sides that actually have an action. The row
    // tracks the finger 1:1 (iOS-style) so a full swipe reaches the commit
    // threshold without fighting resistance.
    const base = openRef.current === 'left' ? ACTION_WIDTH : openRef.current === 'right' ? -ACTION_WIDTH : 0;
    let offset = base + dx;
    if (!leftAction) offset = Math.min(0, offset);
    if (!rightAction) offset = Math.max(0, offset);
    applyOffset(offset, false);

    const commitAt = rowWidthRef.current * COMMIT_FRACTION;
    const pastCommit = commitAt > 0 && Math.abs(offset) >= commitAt;
    if (pastCommit !== pastCommitRef.current) {
      pastCommitRef.current = pastCommit;
      // Tick when crossing into (or back out of) the full-swipe commit zone.
      haptic('light');
    }
  };

  const onTouchEnd = () => {
    startRef.current = null;
    if (!engagedRef.current) return;
    engagedRef.current = false;
    // The synthetic click (if any) lands right after touchend — swallow it,
    // then re-arm clicks for genuine taps.
    setTimeout(() => { justSwipedRef.current = false; }, 100);
    const offset = offsetRef.current;
    const action = offset > 0 ? leftAction : rightAction;
    const commitAt = rowWidthRef.current * COMMIT_FRACTION;

    if (action && commitAt > 0 && Math.abs(offset) >= commitAt) {
      haptic('medium');
      fire(action);
      return;
    }
    if (action && Math.abs(offset) >= ACTION_WIDTH * 0.6) {
      applyOffset(offset > 0 ? ACTION_WIDTH : -ACTION_WIDTH, true);
      setOpen(offset > 0 ? 'left' : 'right');
      return;
    }
    close();
  };

  return (
    <div
      ref={rootRef}
      className={cn('relative overflow-hidden', className)}
      style={{ touchAction: 'pan-y' }}
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      onTouchCancel={close}
      onClickCapture={(e) => {
        // Swallow the tap that ends a swipe, and close-on-tap when open —
        // the row content underneath must not also receive the click.
        if (openRef.current) {
          const zone = offsetRef.current > 0 ? leftZoneRef.current : rightZoneRef.current;
          if (!(zone && e.target instanceof Node && zone.contains(e.target))) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
          return;
        }
        if (justSwipedRef.current) {
          e.preventDefault();
          e.stopPropagation();
        }
      }}
    >
      {leftAction && (
        <div
          ref={leftZoneRef}
          className={cn('absolute inset-y-0 left-0 z-0 flex w-0 items-center justify-center overflow-hidden', leftAction.className)}
        >
          <button
            type="button"
            onClick={() => fire(leftAction)}
            className="flex h-full flex-col items-center justify-center gap-0.5 px-2"
            style={{ minWidth: ACTION_WIDTH }}
          >
            {leftAction.icon}
            <span className="text-[10px] font-medium">{leftAction.label}</span>
          </button>
        </div>
      )}
      {rightAction && (
        <div
          ref={rightZoneRef}
          className={cn('absolute inset-y-0 right-0 z-0 flex w-0 items-center justify-center overflow-hidden', rightAction.className)}
        >
          <button
            type="button"
            onClick={() => fire(rightAction)}
            className="flex h-full flex-col items-center justify-center gap-0.5 px-2"
            style={{ minWidth: ACTION_WIDTH }}
          >
            {rightAction.icon}
            <span className="text-[10px] font-medium">{rightAction.label}</span>
          </button>
        </div>
      )}
      <div ref={contentRef} className={cn('relative z-10 bg-background', contentClassName)}>
        {children}
      </div>
    </div>
  );
}
