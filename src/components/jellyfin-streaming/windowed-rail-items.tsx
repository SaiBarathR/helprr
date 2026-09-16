'use client';

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';

/**
 * Keep the rail's complete geometry, but mount artwork and card hooks only
 * near the visible part of a nearby row. The browser tracks scrolling,
 * transforms and resizing without a layout read for each tile.
 * Permanent slots own the entrance stagger, so card re-entry cannot restart
 * it or change the item's nth-child position.
 */
export function WindowedRailItems({
  children,
  className,
  viewportRef,
  overscanPx = 300,
  trackRef,
  offset = 0,
}: {
  children: ReactNode;
  /** Exactly the card's responsive width and aspect ratio. */
  className: string;
  viewportRef: RefObject<HTMLDivElement | null>;
  /** Horizontal and vertical near-viewport margin before a slot may mount. */
  overscanPx?: number;
  trackRef?: RefObject<HTMLDivElement | null>;
  offset?: number;
}) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const keys = useMemo(
    () => items.map((item, index) => String(isValidElement(item) ? item.key : index)),
    [items],
  );
  const keyList = useMemo(() => JSON.stringify(keys), [keys]);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const [mounted, setMounted] = useState<Set<string>>(() => new Set());

  const refresh = useRef<(() => void) | null>(null);

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const originalPosition = viewport.style.position;
    if (getComputedStyle(viewport).position === 'static') viewport.style.position = 'relative';
    let nearby = false;
    let frame = 0;
    let transitioning = false;
    const update = () => {
      if (frame) window.cancelAnimationFrame(frame);
      frame = 0;
      const next = new Set<string>();
      const viewportLeft = viewport.getBoundingClientRect().left;
      const left = -overscanPx;
      const right = viewport.clientWidth + overscanPx;
      // Every slot uses the same responsive geometry. Read at most two slots,
      // rather than force layout for every card on every scroll frame.
      const first = slots.current.get(keys[0]);
      const second = slots.current.get(keys[1]);
      if (nearby && first) {
        const origin = first.getBoundingClientRect().left - viewportLeft;
        const width = first.offsetWidth;
        const stride = second ? second.offsetLeft - first.offsetLeft : width;
        if (stride > 0) {
          const from = Math.max(0, Math.ceil((left - origin - width) / stride));
          const to = Math.min(keys.length - 1, Math.floor((right - origin) / stride));
          for (let index = from; index <= to; index++) next.add(keys[index]);
        }
      }
      const focused = document.activeElement?.closest<HTMLElement>('[data-rail-slot]');
      if (focused && viewport.contains(focused) && focused.dataset.railSlot) next.add(focused.dataset.railSlot);
      setMounted((current) => current.size === next.size
        && [...next].every((key) => current.has(key)) ? current : next);
      if (transitioning) frame = window.requestAnimationFrame(update);
    };

    const scheduleUpdate = () => {
      if (frame) return;
      frame = window.requestAnimationFrame(update);
    };

    refresh.current = scheduleUpdate;
    const track = trackRef?.current;
    const onTransition = (event: TransitionEvent) => {
      if (event.target !== track || event.propertyName !== 'transform') return;
      transitioning = event.type === 'transitionrun';
      scheduleUpdate();
    };
    track?.addEventListener('transitionrun', onTransition);
    track?.addEventListener('transitionend', onTransition);
    track?.addEventListener('transitioncancel', onTransition);

    const resizeObserver = typeof ResizeObserver !== 'undefined'
      ? new ResizeObserver(scheduleUpdate)
      : null;
    const vertical = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver(([entry]) => {
      nearby = entry.isIntersecting;
      if (nearby) {
        // Latch once per rail. Distant rails need not animate until they
        // approach the viewport.
        viewport.dataset.railArrived = 'true';
      }
      update();
    }, { rootMargin: `${overscanPx}px 0px` }) : null;

    if (vertical) {
      vertical.observe(viewport);
    } else {
      nearby = true;
      viewport.dataset.railArrived = 'true';
      update();
    }
    viewport.addEventListener('scroll', scheduleUpdate, { passive: true });
    viewport.addEventListener('focusin', scheduleUpdate);
    viewport.addEventListener('focusout', scheduleUpdate);
    window.addEventListener('resize', scheduleUpdate);
    resizeObserver?.observe(viewport);
    return () => {
      nearby = false;
      refresh.current = null;
      track?.removeEventListener('transitionrun', onTransition);
      track?.removeEventListener('transitionend', onTransition);
      track?.removeEventListener('transitioncancel', onTransition);
      if (frame) window.cancelAnimationFrame(frame);
      viewport.style.position = originalPosition;
      viewport.removeEventListener('scroll', scheduleUpdate);
      viewport.removeEventListener('focusin', scheduleUpdate);
      viewport.removeEventListener('focusout', scheduleUpdate);
      window.removeEventListener('resize', scheduleUpdate);
      resizeObserver?.disconnect();
      vertical?.disconnect();
    };
  }, [viewportRef, trackRef, keyList, keys, overscanPx]);

  useEffect(() => { refresh.current?.(); }, [offset]);

  return items.map((item, index) => {
    const key = keys[index];
    const visible = mounted.has(key);
    return (
      <div
        key={key}
        ref={(node) => { if (node) slots.current.set(key, node); else slots.current.delete(key); }}
        data-rail-slot={key}
        aria-hidden={visible ? undefined : true}
        className={cn('shrink-0', className, !visible && 'bg-white/5')}
      >
        {visible ? item : null}
      </div>
    );
  });
}
