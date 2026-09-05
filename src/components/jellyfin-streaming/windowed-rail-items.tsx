'use client';

import { Children, isValidElement, useEffect, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react';
import { cn } from '@/lib/utils';

/**
 * Keep the rail's complete geometry, but mount artwork and card hooks only
 * near the visible part of a nearby row. The browser tracks scrolling,
 * transforms and resizing without a layout read for each tile.
 */
export function WindowedRailItems({
  children,
  className,
  viewportRef,
}: {
  children: ReactNode;
  /** Exactly the card's responsive width and aspect ratio. */
  className: string;
  viewportRef: RefObject<HTMLDivElement | null>;
}) {
  const items = useMemo(() => Children.toArray(children), [children]);
  const keys = items.map((item, index) => String(isValidElement(item) ? item.key : index));
  const keyList = JSON.stringify(keys);
  const slots = useRef(new Map<string, HTMLDivElement>());
  const [mounted, setMounted] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const intersecting = new Set<string>();
    const update = () => {
      const next = new Set<string>();
      slots.current.forEach((slot, key) => {
        // Paging or scrolling must never unmount the keyboard's current card.
        if (intersecting.has(key) || slot.contains(document.activeElement)) next.add(key);
      });
      setMounted((current) => current.size === next.size
        && [...next].every((key) => current.has(key)) ? current : next);
    };
    let nearby = false;
    const horizontal = new IntersectionObserver((entries) => {
      if (!nearby) return;
      entries.forEach((entry) => {
        const key = (entry.target as HTMLElement).dataset.railSlot!;
        if (entry.isIntersecting) intersecting.add(key);
        else intersecting.delete(key);
      });
      update();
    }, { root: viewport, rootMargin: '0px 300px' });
    const vertical = new IntersectionObserver(([entry]) => {
      horizontal.disconnect();
      intersecting.clear();
      nearby = entry.isIntersecting;
      if (nearby) {
        slots.current.forEach((slot) => horizontal.observe(slot));
      }
      update();
    }, { rootMargin: '300px 0px' });
    vertical.observe(viewport);
    return () => {
      nearby = false;
      horizontal.disconnect();
      vertical.disconnect();
      intersecting.clear();
    };
  }, [viewportRef, keyList]);

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
