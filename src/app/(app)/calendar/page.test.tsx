// @vitest-environment jsdom

import { useInsertionEffect, type ComponentProps, type ReactNode } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

const route = vi.hoisted(() => ({ pathname: '/calendar', loading: false }));
// The shared filter menus are a sheet on phones and a dropdown from md up.
const viewport = vi.hoisted(() => ({ phone: false }));
const calendar = vi.hoisted(() => ({
  events: null as null | Array<Record<string, unknown>>,
  loading: false,
  refetch: (() => Promise.resolve()) as () => Promise<void>,
  pullToRefresh: null as null | { onRefresh: () => unknown },
}));
// The configured arr instances (/api/instances), which drive the instance filter.
const arr = vi.hoisted(() => ({ instances: undefined as undefined | Array<{ id: string; label: string; type: string }> }));
vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: arr.instances }),
}));
vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/hooks/use-calendar', () => ({
  useCalendar: () => ({
    events: calendar.events ?? [{
      id: 'movie-1', type: 'movie', title: 'Selected day movie', movieId: 1,
      date: '2026-10-15T12:00:00', monitored: true, hasFile: false,
    }],
    loading: calendar.loading,
    error: null,
    refetch: calendar.refetch,
  }),
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: { onRefresh: () => unknown }) => {
    calendar.pullToRefresh = props;
    return null;
  },
}));
vi.mock('@/components/ui/app-link', () => ({
  default: (props: ComponentProps<'a'>) => <a {...props} />,
}));
vi.mock('@/components/ui/quick-context-menu', () => ({
  QuickContextMenu: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/calendar/calendar-feed-dialog', () => ({
  CalendarFeedDialog: () => <p>Calendar feed dialog</p>,
}));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({
  ScheduledAlertButton: () => null,
}));

import CalendarPage from './page';
import { useUIStore } from '@/lib/store';
import { resetRouteViewStateForTests } from '@/lib/hooks/use-route-view-state';
import { RouteScrollRestoration } from '@/components/layout/route-scroll-restoration';
import { clearRouteScrollStateForTests, NAVIGATION_START_EVENT, readRouteScrollState } from '@/lib/route-scroll-state';

// The phone sheet's drag handling.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

let scrollY = 0;
const scrollIntoView = vi.fn();

function Page() {
  // The router puts the new URL in place during the commit, as Next's
  // HistoryUpdater does, so a page rendering it still sees the previous one.
  useInsertionEffect(() => {
    if (window.location.pathname !== route.pathname) window.history.replaceState({}, '', route.pathname);
  });
  return (
    <RouteScrollRestoration pending={false}>
      {route.loading ? <p>Loading</p> : route.pathname === '/calendar' ? <CalendarPage /> : <p>Movie details</p>}
    </RouteScrollRestoration>
  );
}

async function settleScroll() {
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)); });
}

beforeEach(() => {
  arr.instances = undefined;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-22T12:00:00'));
  sessionStorage.clear();
  resetRouteViewStateForTests();
  clearRouteScrollStateForTests();
  route.pathname = '/calendar';
  route.loading = false;
  calendar.loading = false;
  calendar.events = null;
  window.history.replaceState({}, '', '/calendar');
  scrollY = 0;
  scrollIntoView.mockClear();
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    disconnect() {}
    unobserve() {}
  });
  viewport.phone = false;
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return query === '(max-width: 767px)' && viewport.phone; },
    addEventListener() {},
    removeEventListener() {},
  }));
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

async function visit(kind: 'push' | 'traverse', pathname: string, page: ReturnType<typeof render>) {
  window.dispatchEvent(new CustomEvent(NAVIGATION_START_EVENT, { detail: kind === 'push' ? { kind, href: pathname } : { kind } }));
  route.pathname = pathname;
  if (kind === 'traverse') {
    window.history.replaceState({}, '', pathname);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }
  page.rerender(<Page />);
  await settleScroll();
}

it('keeps a picked day for Back only: a fresh visit the same day opens on today', async () => {
  const page = render(<Page />);
  await settleScroll();
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  await visit('push', '/movies/1', page);
  await visit('push', '/calendar', page);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 22');

  // A pick made on this visit still comes back on Back.
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  await visit('push', '/movies/1', page);
  await visit('traverse', '/calendar', page);
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 15');
});

it('jumps to today on a fresh visit even with an earlier position saved', async () => {
  // The jump waits for the toolbar's measurement, so let the observer report.
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe() { this.callback(); }
    disconnect() {}
    unobserve() {}
  });
  useUIStore.setState({ calendarView: 'week' });
  const page = render(<Page />);
  await settleScroll();
  scrollY = 200;
  window.dispatchEvent(new Event('scroll'));
  await settleScroll();
  await visit('push', '/movies/1', page);
  expect(readRouteScrollState('/calendar')).not.toBeNull();
  scrollIntoView.mockClear();
  calendar.loading = true;
  await visit('push', '/calendar', page);
  calendar.loading = false;
  page.rerender(<Page />);
  await settleScroll();
  expect(scrollIntoView.mock.contexts.some((el) => (el as HTMLElement).dataset?.weekDate === '2026-10-22')).toBe(true);
});

it('restores the pick on a Back that commits before its popstate, as the installed iOS app does', async () => {
  const page = render(<Page />);
  await settleScroll();
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  await visit('push', '/movies/1', page);
  // No start event: the route commits first, the popstate follows.
  route.pathname = '/calendar';
  window.history.replaceState({}, '', '/calendar');
  page.rerender(<Page />);
  window.dispatchEvent(new PopStateEvent('popstate'));
  await settleScroll();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 15');
});

it('opens the current month on a fresh visit after paging to another one', async () => {
  const page = render(<Page />);
  await settleScroll();
  fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
  fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
  expect(screen.getByText('December 2026')).toBeTruthy();
  await visit('push', '/movies/1', page);
  await visit('push', '/calendar', page);
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 22');
});

it('still treats the visit as fresh when the route commits its loading view first', async () => {
  const page = render(<Page />);
  await settleScroll();
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  fireEvent.click(screen.getByRole('button', { name: 'Next period' }));
  await visit('push', '/movies/1', page);
  route.loading = true;
  await visit('push', '/calendar', page);
  route.loading = false;
  page.rerender(<Page />);
  await settleScroll();
  expect(screen.getByText('October 2026')).toBeTruthy();
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 22');
});

it('keeps the pick on a Forward back to a freshly visited Calendar (iOS order)', async () => {
  const page = render(<Page />);
  await settleScroll();
  await visit('push', '/movies/1', page);
  await visit('push', '/calendar', page);
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  for (const pathname of ['/movies/1', '/calendar']) {
    // Commit first, popstate after, with no start event.
    route.pathname = pathname;
    page.rerender(<Page />);
    window.dispatchEvent(new PopStateEvent('popstate'));
    await settleScroll();
  }
  expect(screen.getByRole('heading', { level: 2 }).textContent).toBe('Thursday, October 15');
});

it('marks the active scheduled-alerts toggle with the theme primary, not a fixed violet', () => {
  render(<Page />);
  // The toolbar renders once per breakpoint layout.
  const toggles = screen.getAllByRole('button', { name: 'Scheduled alerts' });
  for (const toggle of toggles) {
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(toggle.className).toContain('text-primary');
    expect(toggle.className).not.toMatch(/violet/);
  }
});

it('refetches the shown range on pull to refresh', async () => {
  const refetch = vi.fn(() => Promise.resolve());
  calendar.refetch = refetch;
  render(<CalendarPage />);
  await act(async () => { await calendar.pullToRefresh!.onRefresh(); });
  expect(refetch).toHaveBeenCalledTimes(1);
});

it('keeps the toggles in the ⋯ menu below xl (tablet dropdown) and marks it while they hide events', async () => {
  render(<CalendarPage />);
  const user = userEvent.setup();
  // The phone row's menu comes first; the wide row repeats it.
  const options = () => screen.getAllByRole('button', { name: /^Calendar options/ })[0];
  expect(options().getAttribute('aria-label')).toBe('Calendar options');

  await user.click(options());
  await user.click(screen.getByRole('menuitemcheckbox', { name: 'Monitored only' }));
  expect(useUIStore.getState().calendarMonitoredOnly).toBe(true);
  // A toggle leaves the menu open for the next one.
  expect(screen.getByRole('menuitemcheckbox', { name: 'Monitored only' }).getAttribute('aria-checked')).toBe('true');
  expect(screen.getByRole('menuitem', { name: 'Subscribe in Calendar' })).toBeTruthy();
  await user.keyboard('{Escape}');
  expect(options().getAttribute('aria-label')).toBe('Calendar options (filters active)');
});

it('opens Type and the ⋯ options as phone sheets, like the instance filter', async () => {
  viewport.phone = true;
  render(<CalendarPage />);
  const user = userEvent.setup();
  await user.click(screen.getAllByTitle('All types')[0]);
  const typeSheet = await screen.findByRole('dialog', { name: 'Type' });
  await user.click(within(typeSheet).getByRole('button', { name: /Movies/ }));
  expect(useUIStore.getState().calendarTypeFilter).toBe('movie');
  // A single list of one-choice options closes on the pick, like the instance filter.
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Type' })).toBeNull());

  await user.click(screen.getAllByRole('button', { name: /^Calendar options/ })[0]);
  const options = await screen.findByRole('dialog', { name: 'Calendar options' });
  await user.click(within(options).getByRole('button', { name: 'Scheduled alerts' }));
  expect(useUIStore.getState().calendarShowScheduled).toBe(false);
  // Subscribe closes the sheet before its dialog opens.
  await user.click(within(options).getByRole('button', { name: /Subscribe in Calendar/ }));
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Calendar options' })).toBeNull());
  expect(screen.getByText('Calendar feed dialog')).toBeTruthy();
});

it.each(['agenda', 'week', 'month'] as const)('keeps the instance filter in the %s view, though the range holds one instance', (view) => {
  // Every event in range comes from one instance (no instanceId at all here).
  arr.instances = [
    { id: 'r1', label: 'radarr', type: 'RADARR' },
    { id: 's1', label: 'sonarr-anime', type: 'SONARR' },
  ];
  useUIStore.setState({ calendarView: view });
  render(<CalendarPage />);
  expect(screen.getAllByRole('button', { name: 'Instance: All instances' }).length).toBeGreaterThan(0);
});

it('keeps a saved instance pick until the configured list has loaded', () => {
  useUIStore.setState({ calendarInstanceFilter: 's1' });
  const page = render(<CalendarPage />);
  expect(useUIStore.getState().calendarInstanceFilter).toBe('s1');
  arr.instances = [{ id: 'r1', label: 'radarr', type: 'RADARR' }];
  page.rerender(<CalendarPage />);
  expect(useUIStore.getState().calendarInstanceFilter).toBe('all');
});

// An album has a square cover and no poster; the day panel showed a grey box.
it('shows an album cover in the day panel, through the image proxy', () => {
  calendar.events = [{
    id: 'lidarr-1-7', type: 'album', title: 'LiSA', subtitle: 'Album', artistId: 3, albumId: 7,
    // Local noon, like the other fixtures: this test is about the cover, not the day.
    date: '2026-10-15T12:00:00', monitored: true, hasFile: false,
    images: [{ coverType: 'cover', url: '/MediaCover/Albums/7/cover.jpg', remoteUrl: 'https://imagecache.example/release/7/466' }],
  }];
  useUIStore.setState({ calendarShowImages: true });
  render(<CalendarPage />);
  fireEvent.click(screen.getByRole('button', { name: /October 15, 1 release/ }));
  const panel = screen.getByRole('heading', { level: 2 }).closest('section')!;
  // The poster (160 px wide), not the row's backdrop, which already fell back to the cover.
  const srcs = Array.from(panel.querySelectorAll('img'), (img) => new URL(img.getAttribute('src')!));
  const src = srcs.find((url) => url.searchParams.get('w') === '160')!;
  expect(src.pathname).toBe('/api/image');
  expect(src.searchParams.get('src')).toBe('https://imagecache.example/release/7/466');
  expect(src.searchParams.get('service')).toBe('lidarr');
});
