import { useEffect, useState } from 'react';

/** Scrolls the scroller sideways, and only it, the least that shows the whole selected tab. */
export function scrollActiveTabIntoView(scroller: HTMLElement): void {
  const tab = scroller.querySelector<HTMLElement>('[role="tab"][data-state="active"]');
  if (!tab) return;
  const box = scroller.getBoundingClientRect();
  const rect = tab.getBoundingClientRect();
  if (rect.left < box.left) scroller.scrollLeft -= box.left - rect.left;
  else if (rect.right > box.right) scroller.scrollLeft += rect.right - box.right;
}

/**
 * Keeps a scrolling tab track's selected tab on screen: when it mounts, when
 * the selection changes, and when the track or its tabs change size (a zoom,
 * larger text, the font arriving). A saved scroll offset could leave it out of
 * view after a reload at another zoom, so such a track opts out of route scroll
 * restoration (data-scroll-restoration-ignore) and relies on this instead.
 * Only the track scrolls: scrollIntoView would move the page as well.
 * Returns the callback ref for the scroller (it may mount after the page,
 * once permissions offer more than one tab).
 */
export function useActiveTabInView(value: string | null | undefined): (element: HTMLElement | null) => void {
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useEffect(() => {
    if (!scroller) return;
    scrollActiveTabIntoView(scroller);
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => scrollActiveTabIntoView(scroller));
    observer.observe(scroller);
    if (scroller.firstElementChild) observer.observe(scroller.firstElementChild);
    return () => observer.disconnect();
  }, [scroller, value]);
  return setScroller;
}
