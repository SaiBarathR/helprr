// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/calendar' }));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-calendar', () => ({
  useCalendar: () => ({
    events: [{
      id: 'movie-1', type: 'movie', title: 'Selected day movie', movieId: 1,
      date: '2026-10-15T12:00:00', monitored: true, hasFile: false,
    }],
    loading: false,
    error: null,
  }),
}));
vi.mock('@/components/ui/app-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({
  ScheduledAlertButton: () => null,
}));

import CalendarPage from './page';
import { useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import { RouteScrollRestoration } from '@/components/layout/route-scroll-restoration';
import { clearRouteScrollStateForTests, NAVIGATION_START_EVENT, readRouteScrollState } from '@/lib/route-scroll-state';

let scrollY = 0;
const scrollIntoView = vi.fn();

function Page() {
  return (
    <RouteScrollRestoration pending={false}>
      {route.pathname === '/calendar' ? <CalendarPage /> : <p>Movie details</p>}
    </RouteScrollRestoration>
  );
}

async function settleScroll() {
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T12:00:00'));
  sessionStorage.clear();
  resetRouteViewStateForTests();
  clearRouteScrollStateForTests();
  route.pathname = '/calendar';
  window.history.replaceState({}, '', '/calendar');
  scrollY = 0;
  scrollIntoView.mockClear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  Element.prototype.scrollIntoView = scrollIntoView;
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => scrollY);
  vi.spyOn(document.documentElement, 'scrollHeight', 'get').mockReturnValue(2400);
  vi.spyOn(window, 'scrollTo').mockImplementation((options: ScrollToOptions | number) => {
    if (typeof options === 'object') scrollY = options.top ?? scrollY;
  });
  useUIStore.setState({
    calendarView: 'month', calendarTypeFilter: 'all', calendarMonitoredOnly: false,
    calendarInstanceFilter: 'all', calendarShowScheduled: true, calendarShowImages: false,
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(Element.prototype, 'scrollIntoView');
});

it('does not pin the month: a later fresh visit opens on that day', () => {
  const page = render(<CalendarPage />);
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 15');
  page.unmount();
  const saved = JSON.parse(sessionStorage.getItem('helprr:route-views:v1')!)[0][1];
  expect(saved.manualSelection.key).toBe('2026-10-15');
  expect(saved).not.toHaveProperty('currentDate');

  vi.setSystemTime(new Date('2026-11-02T09:00:00'));
  render(<CalendarPage />);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Monday, November 2');
});

it.each(['memory', 'sessionStorage'])('restores the selected panel and scroll on history traversal from %s', async (storage) => {
  const page = render(<Page />);
  await settleScroll();
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  await settleScroll();
  const panel = screen.getByRole('heading', { level: 2 }).closest('section')!;
  expect(within(panel).getByRole('link', { name: /Selected day movie/ }).getAttribute('href')).toBe('/movies/1');
  scrollY = 640;
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail: { kind: 'push', href: '/movies/1' } }));
  route.pathname = '/movies/1';
  window.history.replaceState({}, '', route.pathname);
  page.rerender(<Page />);
  await settleScroll();
  expect(readRouteScrollState('/calendar')?.document.top).toBe(640);

  if (storage === 'sessionStorage') resetRouteViewStateForTests();
  vi.setSystemTime(new Date('2026-10-22T12:05:00'));
  scrollIntoView.mockClear();
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail: { kind: 'traverse' } }));
  route.pathname = '/calendar';
  window.history.replaceState({}, '', route.pathname);
  window.dispatchEvent(new PopStateEvent('popstate'));
  page.rerender(<Page />);
  await settleScroll();

  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 15');
  expect(scrollY).toBe(640);
  expect(scrollIntoView).not.toHaveBeenCalled();
});

it('opens today on a fresh mount without restore state', () => {
  render(<CalendarPage />);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 22');
  expect(sessionStorage.getItem('helprr:route-views:v1')).toBeNull();
});

it('resets the picked day when using Today or changing the month', () => {
  render(<CalendarPage />);
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  vi.setSystemTime(new Date('2026-10-22T12:01:00'));
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 22');

  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
  expect(screen.queryByRole('heading', { level: 2 })).toBeNull();
  vi.setSystemTime(new Date('2026-10-22T12:02:00'));
  fireEvent.click(screen.getByRole('button', { name: 'Today' }));
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 22');
});
