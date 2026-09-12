// @vitest-environment jsdom

import { act, createContext, StrictMode, useContext } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const LocationContext = createContext({ pathname: '/movies', search: '' });
vi.mock('next/navigation', () => ({
  usePathname: () => useContext(LocationContext).pathname,
  useSearchParams: () => new URLSearchParams(useContext(LocationContext).search),
}));

import { RouteScrollRestoration } from './route-scroll-restoration';
import {
  NAVIGATION_START_EVENT,
  clearRouteScrollStateForTests,
  readRouteScrollState,
  writeRouteScrollState,
  type NavigationStartDetail,
} from '@/lib/route-scroll-state';

let root: Root;
let route = { pathname: '/movies', search: '' };
let scrollY = 0;
let resizeCallback: ResizeObserverCallback;
const scrollTo = vi.fn((options: ScrollToOptions | number, y?: number) => {
  const requested = typeof options === 'number' ? y ?? scrollY : options.top ?? scrollY;
  scrollY = Math.min(requested, Math.max(0, document.documentElement.scrollHeight - window.innerHeight));
});

function metric(element: Element, name: string, value: number) {
  Object.defineProperty(element, name, { configurable: true, value });
}

function Page({ rail = false }: { rail?: boolean }) {
  return <div data-page={route.pathname}>{rail && <div data-scroll-restoration-key="rail" />}</div>;
}

function render(page = <Page />) {
  return act(async () => root.render(
    <LocationContext.Provider value={route}>
      <RouteScrollRestoration pending={false}>{page}</RouteScrollRestoration>
    </LocationContext.Provider>,
  ));
}

function navigate(detail: NavigationStartDetail) {
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail }));
}

beforeEach(async () => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  sessionStorage.clear();
  clearRouteScrollStateForTests();
  route = { pathname: '/movies', search: '' };
  scrollY = 0;
  Object.defineProperty(window.history, 'scrollRestoration', { configurable: true, writable: true, value: 'auto' });
  window.history.replaceState({}, '', '/movies');
  Object.defineProperty(window, 'scrollY', { configurable: true, get: () => scrollY });
  Object.defineProperty(window, 'scrollX', { configurable: true, get: () => 0 });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  metric(document.documentElement, 'scrollHeight', 2000);
  vi.stubGlobal('ResizeObserver', class {
    constructor(callback: ResizeObserverCallback) { resizeCallback = callback; }
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(scrollTo);
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
  await render(<Page rail />);
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('route scroll restoration lifecycle', () => {
  it('does not pin a fresh dashboard behind lazy skeletons', async () => {
    navigate({ kind: 'push', href: '/' });
    route = { pathname: '/', search: '' };
    window.history.replaceState({}, '', '/');
    await render(<div data-slot="skeleton" />);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    scrollY = 900;
    window.dispatchEvent(new Event('scroll'));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(readRouteScrollState('/')?.document.top).toBe(900);
  });

  it('stops retrying an impossible offset after the loading window', async () => {
    vi.useFakeTimers();
    try {
      writeRouteScrollState('/series', { document: { top: 5000, left: 0 }, elements: {} });
      navigate({ kind: 'push', href: '/series' });
      route = { pathname: '/series', search: '' };
      window.history.replaceState({}, '', '/series');
      await render(<Page />);
      await act(async () => vi.advanceTimersByTime(8100));
      expect(scrollY).toBe(1200);
      metric(document.documentElement, 'scrollHeight', 10000);
      await act(async () => resizeCallback([], {} as ResizeObserver));
      window.dispatchEvent(new Event('resize'));
      await act(async () => vi.advanceTimersByTime(100));
      expect(scrollY).toBe(1200);
    } finally { vi.useRealTimers(); }
  });

  it('preserves a saved destination when a settled page temporarily collapses', async () => {
    scrollY = 900;
    window.dispatchEvent(new Event('scroll'));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    metric(document.documentElement, 'scrollHeight', 800);
    scrollY = 0;
    window.dispatchEvent(new Event('scroll'));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    navigate({ kind: 'push', href: '/series' });
    expect(readRouteScrollState('/movies')?.document.top).toBe(900);
  });

  it('reapplies the target while asynchronous layout settles', async () => {
    vi.useFakeTimers();
    try {
      writeRouteScrollState('/calendar', { document: { top: 900, left: 0 }, elements: {} });
      navigate({ kind: 'push', href: '/calendar' });
      route = { pathname: '/calendar', search: '' };
      window.history.replaceState({}, '', '/calendar');
      await render(<Page />);
      await act(async () => vi.advanceTimersByTime(50));
      scrollY = 924;
      await act(async () => resizeCallback([], {} as ResizeObserver));
      await act(async () => vi.advanceTimersByTime(50));
      expect(scrollY).toBe(900);
      await act(async () => vi.advanceTimersByTime(500));
    } finally { vi.useRealTimers(); }
  });

  it('restores on reload and survives StrictMode effect replay', async () => {
    await act(async () => root.unmount());
    writeRouteScrollState('/movies', { document: { top: 650, left: 0 }, elements: {} });
    scrollY = 0;
    root = createRoot(document.getElementById('root')!);
    await act(async () => root.render(<StrictMode><LocationContext.Provider value={route}>
      <RouteScrollRestoration pending={false}><Page /></RouteScrollRestoration>
    </LocationContext.Provider></StrictMode>));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollY).toBe(650);
    window.dispatchEvent(new WheelEvent('wheel'));
    scrollY = 700;
    window.dispatchEvent(new Event('scroll'));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(readRouteScrollState('/movies')?.document.top).toBe(700);
  });

  it('keeps capturing after a hash-only history traversal', async () => {
    navigate({ kind: 'traverse' });
    window.history.replaceState({}, '', '/movies#details');
    window.dispatchEvent(new PopStateEvent('popstate'));
    scrollY = 400;
    window.dispatchEvent(new Event('scroll'));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(readRouteScrollState('/movies')?.document.top).toBe(400);
  });

  it('does not accept tall placeholder geometry as a completed restore', async () => {
    writeRouteScrollState('/series/9', { document: { top: 600, left: 0 }, elements: {} });
    navigate({ kind: 'push', href: '/series/9' });
    route = { pathname: '/series/9', search: '' };
    window.history.replaceState({}, '', '/series/9');
    await render(<div data-slot="skeleton" />);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    scrollY = 200;
    window.dispatchEvent(new Event('scroll'));
    expect(readRouteScrollState('/series/9')?.document.top).toBe(600);
    await render(<Page />);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollY).toBe(600);
  });
  it('freezes a saved target while layout is short, then restores after resize', async () => {
    scrollY = 500;
    const rail = document.querySelector<HTMLElement>('[data-scroll-restoration-key="rail"]')!;
    rail.scrollLeft = 260;
    navigate({ kind: 'push', href: '/series/7?instance=two' });
    writeRouteScrollState('/series/7?instance=two', {
      document: { top: 700, left: 0 }, elements: { 'named:rail': { top: 0, left: 420 } },
    });

    metric(document.documentElement, 'scrollHeight', 900);
    route = { pathname: '/series/7', search: '?instance=two' };
    window.history.replaceState({}, '', '/series/7?instance=two');
    await render(<Page rail />);
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollY).toBe(100);

    // Programmatic/clamped scroll notifications cannot overwrite the target.
    window.dispatchEvent(new Event('scroll'));
    expect(readRouteScrollState('/series/7?instance=two')?.document.top).toBe(700);

    metric(document.documentElement, 'scrollHeight', 1800);
    const nextRail = document.querySelector<HTMLElement>('[data-scroll-restoration-key="rail"]')!;
    metric(nextRail, 'scrollWidth', 900);
    metric(nextRail, 'clientWidth', 300);
    Object.defineProperty(nextRail, 'scrollTo', { configurable: true, value: vi.fn((value: ScrollToOptions) => {
      nextRail.scrollLeft = value.left ?? 0;
    }) });
    await act(async () => resizeCallback([], {} as ResizeObserver));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollY).toBe(700);
    expect(nextRail.scrollLeft).toBe(420);
  });

  it('freezes the outgoing route on popstate before the next DOM commits', async () => {
    scrollY = 640;
    window.history.replaceState({}, '', '/series/3');
    window.dispatchEvent(new PopStateEvent('popstate'));
    scrollY = 0;
    window.dispatchEvent(new Event('scroll'));
    expect(readRouteScrollState('/movies')?.document.top).toBe(640);

    route = { pathname: '/series/3', search: '' };
    await render();
  });

  it('preserves position for an explicit scroll:false query commit', async () => {
    scrollY = 380;
    navigate({ kind: 'replace', href: '/movies?filter=missing', preserveScroll: true });
    route = { pathname: '/movies', search: '?filter=missing' };
    window.history.replaceState({}, '', '/movies?filter=missing');
    scrollTo.mockClear();
    await render();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollY).toBe(380);
  });

  it('preserves new navigation options when an unfinished restoration is disposed', async () => {
    writeRouteScrollState('/series/9', { document: { top: 900, left: 0 }, elements: {} });
    navigate({ kind: 'push', href: '/series/9' });
    metric(document.documentElement, 'scrollHeight', 900);
    route = { pathname: '/series/9', search: '' };
    window.history.replaceState({}, '', '/series/9');
    await render();
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollY).toBe(100);
    navigate({ kind: 'push', href: '/series/10', preserveScroll: true });
    metric(document.documentElement, 'scrollHeight', 2000);
    await act(async () => resizeCallback([], {} as ResizeObserver));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollY).toBe(100);
    route = { pathname: '/series/10', search: '' };
    window.history.replaceState({}, '', '/series/10');
    scrollTo.mockClear();
    await render();
    expect(scrollTo).not.toHaveBeenCalled();
    expect(readRouteScrollState('/series/9')?.document.top).toBe(900);
  });

  it('cancels an unreachable restore on wheel, but not an ordinary click', async () => {
    writeRouteScrollState('/series/9', { document: { top: 900, left: 0 }, elements: {} });
    navigate({ kind: 'push', href: '/series/9' });
    metric(document.documentElement, 'scrollHeight', 900);
    route = { pathname: '/series/9', search: '' };
    window.history.replaceState({}, '', '/series/9');
    await render();
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    window.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true }));
    window.dispatchEvent(new WheelEvent('wheel'));
    metric(document.documentElement, 'scrollHeight', 2000);
    scrollTo.mockClear();
    await act(async () => resizeCallback([], {} as ResizeObserver));
    await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('restores the browser scroll-restoration setting on unmount', async () => {
    await act(async () => root.unmount());
    expect(window.history.scrollRestoration).toBe('auto');
    document.body.innerHTML = '<div id="root"></div>';
    root = createRoot(document.getElementById('root')!);
  });
});
