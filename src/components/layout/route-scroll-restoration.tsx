'use client';

import { useCallback, useEffect, useRef } from 'react';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  NAVIGATION_CANCEL_EVENT, NAVIGATION_START_EVENT,
  applyRouteScroll, captureRouteScroll, flushRouteScrollState, isScrollIntent,
  readRouteScrollState, routeScrollKey, writeRouteScrollState,
  type NavigationStartDetail,
} from '@/lib/route-scroll-state';

type PendingNavigation = NavigationStartDetail & { destination?: string; source: string; id: number };

export function RouteScrollRestoration({ children, pending }: { children: React.ReactNode; pending: boolean }) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const rootRef = useRef<HTMLDivElement>(null);
  const routeRef = useRef('');
  const frozenRef = useRef(false);
  const pendingNavigationRef = useRef<PendingNavigation | null>(null);
  const navigationIdRef = useRef(0);
  const restoreIdRef = useRef(0);
  const restoringRef = useRef(false);
  const scheduleRestoreRef = useRef<(() => void) | null>(null);
  const cancelRestoreRef = useRef<(() => void) | null>(null);
  const captureFrame = useRef(0);
  const userScrollRef = useRef(false);

  const capture = useCallback((flush = false) => {
    const root = rootRef.current;
    const route = routeRef.current;
    if (!root || !route || frozenRef.current) return;
    const next = captureRouteScroll(root);
    const saved = readRouteScrollState(route);
    const maxTop = Math.max(0, (document.scrollingElement ?? document.documentElement).scrollHeight - window.innerHeight);
    // A loading/error layout can clamp the browser without a user scroll.
    // Preserve the last usable destination across that temporary collapse.
    if (!userScrollRef.current && saved && saved.document.top > maxTop && next.document.top >= maxTop) {
      next.document = saved.document;
      next.elements = { ...saved.elements, ...next.elements };
    }
    userScrollRef.current = false;
    writeRouteScrollState(route, next);
    if (flush) flushRouteScrollState(route);
  }, []);

  useEffect(() => {
    const previous = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    const scheduleCapture = () => {
      if (frozenRef.current || captureFrame.current) return;
      captureFrame.current = window.requestAnimationFrame(() => { captureFrame.current = 0; capture(); });
    };
    const onNavigationStart = (event: Event) => {
      const detail = (event as CustomEvent<NavigationStartDetail>).detail;
      const destination = detail.href ? routeScrollKey(new URL(detail.href, window.location.href)) : undefined;
      // Hash-only navigation belongs to the browser's anchor algorithm. It is
      // the same route snapshot and must not leave capture frozen waiting for
      // a pathname/search commit that will never happen.
      if (destination && destination === routeRef.current) {
        pendingNavigationRef.current = null;
        cancelRestoreRef.current?.();
        frozenRef.current = false;
        return;
      }
      capture(true);
      frozenRef.current = true;
      pendingNavigationRef.current = {
        ...detail,
        destination,
        source: routeRef.current,
        id: ++navigationIdRef.current,
      };
    };
    const onPopState = () => {
      const destination = routeScrollKey(window.location);
      const pending = pendingNavigationRef.current;
      // The router can commit the new route before its popstate arrives, which
      // is what iOS standalone does. That popstate belongs to the restoration
      // already running for this route: cancelling it would abandon the restore,
      // and re-pending it would block every attempt until the deadline.
      if (destination === routeRef.current && restoringRef.current) {
        return;
      }
      if (destination === routeRef.current && (!pending || pending.source === destination)) {
        // traverseHistory() freezes before history moves. A hash-only popstate
        // has no pathname/search commit, so release that freeze here and let
        // the browser retain ownership of anchor scrolling.
        pendingNavigationRef.current = null;
        cancelRestoreRef.current?.();
        frozenRef.current = restoringRef.current;
        if (!frozenRef.current) scheduleCapture();
        return;
      }
      if (!frozenRef.current) { capture(true); frozenRef.current = true; }
      pendingNavigationRef.current = {
        kind: 'traverse', destination, source: routeRef.current, id: ++navigationIdRef.current,
      };
    };
    const onNavigationCancel = () => {
      if (pendingNavigationRef.current?.source !== routeRef.current) return;
      pendingNavigationRef.current = null;
      frozenRef.current = restoringRef.current;
      if (!frozenRef.current) scheduleCapture();
      else scheduleRestoreRef.current?.();
    };
    const onPageHide = () => capture(true);
    const onVisibilityChange = () => { if (document.visibilityState === 'hidden') capture(true); };
    document.addEventListener('visibilitychange', onVisibilityChange);

    const onIntent = (event: Event) => { if (isScrollIntent(event)) userScrollRef.current = true; };
    for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(event, onIntent, true);
    window.addEventListener('scroll', scheduleCapture, true);
    window.addEventListener(NAVIGATION_START_EVENT, onNavigationStart);
    window.addEventListener(NAVIGATION_CANCEL_EVENT, onNavigationCancel);
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      capture(true);
      if (captureFrame.current) window.cancelAnimationFrame(captureFrame.current);
      window.history.scrollRestoration = previous;
      for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.removeEventListener(event, onIntent, true);
      window.removeEventListener('scroll', scheduleCapture, true);
      window.removeEventListener(NAVIGATION_START_EVENT, onNavigationStart);
      window.removeEventListener(NAVIGATION_CANCEL_EVENT, onNavigationCancel);
      window.removeEventListener('popstate', onPopState);
      window.removeEventListener('pagehide', onPageHide);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [capture]);

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    const restoreId = ++restoreIdRef.current;
    const nextRoute = routeScrollKey(window.location);
    const navigation = pendingNavigationRef.current;
    const routeChanged = routeRef.current !== nextRoute;
    routeRef.current = nextRoute;
    userScrollRef.current = false;

    // A scroll:false replace syncs the current view into the URL, so the
    // viewport must not jump. Once that view has its own saved offset, though,
    // the user is returning to it rather than switching within it, and keeping
    // the arrival position would overwrite the offset they left behind.
    const saved = readRouteScrollState(nextRoute);
    if (routeChanged && navigation?.preserveScroll && navigation.destination === nextRoute && !saved) {
      frozenRef.current = false;
      restoringRef.current = false;
      pendingNavigationRef.current = null;
      writeRouteScrollState(nextRoute, captureRouteScroll(root));
      return;
    }
    // Effects are replayed by StrictMode. Re-establish restoration even when
    // the pathname is unchanged after the previous effect was disposed.
    if (window.location.hash && navigation?.kind !== 'traverse') {
      frozenRef.current = false;
      restoringRef.current = false;
      pendingNavigationRef.current = null;
      return;
    }

    const snapshot = saved;
    const target = snapshot ?? { document: { top: 0, left: 0 }, elements: {} };
    frozenRef.current = true;
    restoringRef.current = true;
    let stopped = false;
    let frame = 0;
    let settleTimer = 0;
    let deadline = 0;
    const previousAnchor = root.style.overflowAnchor;
    root.style.overflowAnchor = 'none';
    let resize: ResizeObserver | null = null;
    let mutations: MutationObserver | null = null;
    const dispose = () => {
      if (stopped) return;
      stopped = true;
      if (frame) window.cancelAnimationFrame(frame);
      window.clearTimeout(settleTimer);
      window.clearTimeout(deadline);
      root.style.overflowAnchor = previousAnchor;
      resize?.disconnect();
      mutations?.disconnect();
      if (scheduleRestoreRef.current === schedule) scheduleRestoreRef.current = null;
      if (cancelRestoreRef.current === finish) cancelRestoreRef.current = null;
      window.removeEventListener('resize', schedule);
      for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.removeEventListener(event, cancelOnIntent, true);
    };
    const finish = () => {
      dispose();
      if (restoreIdRef.current !== restoreId) return;
      restoringRef.current = false;
      if (pendingNavigationRef.current === navigation) pendingNavigationRef.current = null;
      frozenRef.current = pendingNavigationRef.current !== null;
    };
    const attempt = () => {
      frame = 0;
      if (stopped) return;
      if (pendingNavigationRef.current?.source === nextRoute && pendingNavigationRef.current !== navigation) return;
      const complete = applyRouteScroll(root, target);
      // Lazy widgets below the restored viewport do not participate in its
      // geometry. Waiting for every skeleton would lock the dashboard forever.
      const placeholder = [...root.querySelectorAll<HTMLElement>('[data-slot="skeleton"], [data-scroll-restoration-pending], [aria-busy="true"]')]
        .some((element) => element.getBoundingClientRect().top < window.innerHeight);
      if (!snapshot) { finish(); return; }
      window.clearTimeout(settleTimer);
      if (complete && !placeholder) settleTimer = window.setTimeout(finish, 400);
    };
    const schedule = () => {
      if (!stopped && !frame) frame = window.requestAnimationFrame(attempt);
    };
    const cancelOnIntent = (event: Event) => {
      if (!isScrollIntent(event)) return;
      finish();
    };
    scheduleRestoreRef.current = schedule;
    cancelRestoreRef.current = finish;
    resize = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(schedule);
    mutations = new MutationObserver(schedule);
    resize?.observe(root);
    mutations.observe(root, { childList: true, subtree: true, attributes: true, attributeFilter: ['aria-busy', 'data-scroll-restoration-pending'] });
    window.addEventListener('resize', schedule);
    for (const event of ['wheel', 'touchmove', 'keydown', 'pointerdown']) window.addEventListener(event, cancelOnIntent, true);
    // A changed viewport or removed item can make the old offset impossible.
    // Stop owning scroll after a bounded loading window instead of teleporting
    // the user when the page resizes much later.
    deadline = window.setTimeout(finish, 8000);
    schedule();

    return () => {
      dispose();
      restoringRef.current = false;
    };
  }, [pathname, search]);

  return (
    <div ref={rootRef} data-route-scroll-root aria-hidden={pending || undefined} inert={pending || undefined}
      className={pending ? 'pointer-events-none invisible' : undefined}>
      {children}
    </div>
  );
}
