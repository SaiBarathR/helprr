// @vitest-environment jsdom

import { Profiler, type ComponentProps, type ReactNode } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const virtual = vi.hoisted(() => ({ useWindowVirtualizer: vi.fn(), measure: vi.fn(), scrollToIndex: vi.fn() }));
vi.mock('@tanstack/react-virtual', () => ({ useWindowVirtualizer: virtual.useWindowVirtualizer }));
vi.mock('next/navigation', () => ({
  usePathname: () => '/calendar',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-calendar', () => ({
  useCalendar: () => ({
    events: [{ id: 'movie-1', type: 'movie', title: 'Movie', movieId: 1, date: '2026-10-15T12:00:00', monitored: true }],
    loading: false,
    error: null,
  }),
}));
vi.mock('@/components/ui/app-link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/components/ui/quick-context-menu', () => ({ QuickContextMenu: ({ children }: { children: ReactNode }) => children }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertButton: () => null }));

import CalendarPage from './page';
import { useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import { clearRouteScrollStateForTests } from '@/lib/route-scroll-state';

let listTop = 240;
let toolbarHeight = 80;
let frameId = 0;
const frames = new Map<number, FrameRequestCallback>();
const observers = new Map<Element, { notify: () => void; disconnect: ReturnType<typeof vi.fn> }>();
const onRender = vi.fn();

function flushFrame() {
  const callbacks = [...frames.values()];
  frames.clear();
  act(() => callbacks.forEach((callback) => callback(0)));
}

function mount() {
  const page = render(<Profiler id="calendar" onRender={onRender}><CalendarPage /></Profiler>);
  const toolbar = page.container.querySelector<HTMLElement>('.page-toolbar')!;
  const list = page.container.querySelector<HTMLElement>('.relative.w-full')!;
  return { ...page, toolbar, list };
}

const options = () => virtual.useWindowVirtualizer.mock.lastCall![0];
const offset = (toolbar: HTMLElement) => toolbar.parentElement!.style.getPropertyValue('--calendar-sticky-offset');

beforeEach(() => {
  vi.clearAllMocks();
  sessionStorage.clear();
  resetRouteViewStateForTests();
  clearRouteScrollStateForTests();
  listTop = 240;
  toolbarHeight = 80;
  frameId = 0;
  frames.clear();
  observers.clear();
  virtual.useWindowVirtualizer.mockImplementation((options) => ({
    options, measure: virtual.measure, scrollToIndex: virtual.scrollToIndex,
    getTotalSize: () => 100, getVirtualItems: () => [],
  }));
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => {
    frames.set(++frameId, callback);
    return frameId;
  }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => frames.delete(id)));
  vi.stubGlobal('ResizeObserver', class {
    disconnect = vi.fn();
    constructor(private callback: () => void) {}
    observe(element: Element) { observers.set(element, { notify: this.callback, disconnect: this.disconnect }); }
    unobserve() {}
  });
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {});
  vi.spyOn(window, 'scrollY', 'get').mockReturnValue(64);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({ top: listTop }) as DOMRect);
  // The toolbar's stuck top comes from CSS, so it is there when the page first measures.
  const computed = window.getComputedStyle.bind(window);
  vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = computed(element, pseudo);
    return (element as HTMLElement).classList?.contains('page-toolbar')
      ? ({ ...style, top: '48px', getPropertyValue: style.getPropertyValue.bind(style) } as CSSStyleDeclaration)
      : style;
  });
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('page-toolbar') ? toolbarHeight : 0;
  });
  useUIStore.setState({
    calendarView: 'agenda', calendarTypeFilter: 'all', calendarMonitoredOnly: false,
    calendarInstanceFilter: 'all', calendarShowScheduled: true, calendarShowImages: false,
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('defers both observer updates and coalesces notifications while preserving the measurements', () => {
  const { toolbar, list } = mount();
  expect(options().scrollMargin).toBe(304);
  expect(offset(toolbar)).toBe('136px');
  listTop = 260;
  toolbarHeight = 100;
  act(() => {
    for (let i = 0; i < 2; i++) {
      observers.get(toolbar)!.notify();
      observers.get(list)!.notify();
    }
  });
  expect(options().scrollMargin).toBe(304);
  expect(offset(toolbar)).toBe('136px');
  expect(frames.size).toBe(2);
  flushFrame();
  expect(options().scrollMargin).toBe(324);
  expect(options().scrollPaddingStart).toBe(156);
  expect(offset(toolbar)).toBe('156px');
  expect(options().count).toBe(1);
  expect(options().estimateSize()).toBe(62);
  expect(options().overscan).toBe(5);
});

it.each(['toolbar', 'list'] as const)('does not set unchanged measurements from the %s observer', (target) => {
  const page = mount();
  act(() => observers.get(page.toolbar)!.notify());
  flushFrame();
  if (target === 'toolbar') toolbarHeight += 20;
  else listTop += 20;
  act(() => observers.get(page[target])!.notify());
  flushFrame();
  onRender.mockClear();
  for (let i = 0; i < 2; i++) {
    act(() => observers.get(page[target])!.notify());
    flushFrame();
  }
  expect(onRender).not.toHaveBeenCalled();
});

it('defers window resize updates and cancels pending measurements and listeners on unmount', () => {
  const { toolbar, list, unmount } = mount();
  listTop += 20;
  toolbarHeight += 20;
  act(() => window.dispatchEvent(new Event('resize')));
  expect(options().scrollMargin).toBe(304);
  expect(offset(toolbar)).toBe('136px');
  expect(frames.size).toBe(2);
  const pendingIds = [...frames.keys()];
  unmount();
  expect(observers.get(toolbar)!.disconnect).toHaveBeenCalled();
  expect(observers.get(list)!.disconnect).toHaveBeenCalled();
  for (const id of pendingIds) expect(cancelAnimationFrame).toHaveBeenCalledWith(id);
  expect(frames.size).toBe(0);
  window.dispatchEvent(new Event('resize'));
  expect(frames.size).toBe(0);
});
