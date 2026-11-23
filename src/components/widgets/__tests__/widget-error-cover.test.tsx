// @vitest-environment jsdom

import type { ComponentType, ReactNode } from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetAvailabilityProvider } from '@/lib/widgets/widget-availability-context';
import type { WidgetDefinition, WidgetProps } from '@/lib/widgets/types';

const mocks = vi.hoisted(() => ({ component: null as ComponentType<WidgetProps> | null, name: '', interval: 30 }));

vi.mock('@/lib/store', () => ({
  useUIStore: (selector: (state: { discoverLayout: null }) => unknown) => selector({ discoverLayout: null }),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn(), prefetch: vi.fn() }) }));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 300, height: 300 }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 5, fetchSize: 5 }) }));
vi.mock('../dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/widgets/registry', () => ({
  getWidgetDefinition: (id: string): WidgetDefinition => ({
    id,
    name: mocks.name,
    description: '',
    icon: 'BarChart3',
    category: 'overview',
    defaultDesktopSpan: { colSpan: 4, rowSpan: 2 },
    defaultMobileSpan: { colSpan: 4, rowSpan: 2 },
    defaultRefreshIntervalSecs: mocks.interval,
  }),
}));
vi.mock('../widget-loaders', () => ({
  getWidgetComponent: () => mocks.component,
  resetWidgetComponent: () => {},
}));

import { WidgetRenderer } from '../widget-renderer';
import { TorrentWidget } from '../torrent-widget';
import { ContinueWatchingWidget } from '../continue-watching-widget';
import { NotificationsWidget } from '../notifications-widget';
import { RecentlyAddedWidget } from '../recently-added-widget';
import { ActivityHistoryWidget } from '../activity-history-widget';
import { UpcomingWidget } from '../upcoming-widget';

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

async function show(name: string, component: ComponentType<WidgetProps>, fetchImpl: (url: string) => Promise<Response>) {
  mocks.name = name;
  mocks.component = component;
  vi.stubGlobal('fetch', vi.fn((url: string) => fetchImpl(String(url))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <WidgetAvailabilityProvider services={['JELLYFIN']}>
        <WidgetRenderer instance={{ id: `${name}-1`, widgetId: name, colSpan: 4, rowSpan: 2 }} rowSpan={2} />
      </WidgetAvailabilityProvider>
    </QueryClientProvider>,
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
});

afterEach(() => {
  mocks.interval = 30;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// What dev answered on 2026-11-18: a 200 whose body isn't JSON (WebKit's
// parser then says "The string did not match the expected pattern.").
const notJson = async () => new Response('<!doctype html>', { headers: { 'content-type': 'application/json' } });
const serverError = async () => json({ error: 'Internal error' }, 500);
const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

describe('dashboard widgets whose data failed to load', () => {
  const widgets: Array<[string, ComponentType<WidgetProps>]> = [
    ['Continue Watching', ContinueWatchingWidget],
    ['Notifications', NotificationsWidget],
    ['Recently Added', RecentlyAddedWidget],
    ['Activity', ActivityHistoryWidget],
    ['Upcoming', UpcomingWidget],
  ];
  const failures = [['an answer that is not JSON', notJson], ['an HTTP 500', serverError]] as const;

  for (const [name, component] of widgets) {
    for (const [label, answer] of failures) {
      it(`${name} says it couldn't load, with Retry, for ${label}, instead of its empty state`, async () => {
        await show(name, component, answer);
        expect(screen.getByRole('status').textContent).toBe(`${name}Couldn’t load its data.Retry`);
        expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
      });
    }
  }

  it('Retry loads again, and a working answer shows the widget', async () => {
    let up = false;
    await show('Notifications', NotificationsWidget, async () => (up ? json({ notifications: [] }) : notJson()));
    expect(screen.getByRole('status').textContent).toContain('Couldn’t load');
    up = true;
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent).toContain('No recent notifications');
  });

  it('keeps data already on screen through failed loads', async () => {
    mocks.interval = 15;
    let up = true;
    await show('Torrents', TorrentWidget, () => (up ? Promise.resolve(json({ total: 3, downloading: 1, seeding: 2, paused: 0 })) : serverError()));
    up = false;
    await act(async () => vi.advanceTimersByTimeAsync(45_100));
    expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(3);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('a real empty answer still shows the empty state', async () => {
    await show('Notifications', NotificationsWidget, async () => json({ notifications: [] }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent).toContain('No recent notifications');
  });

  it('offline still shows the offline cover, without Retry', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await show('Continue Watching', ContinueWatchingWidget, unreachable);
    expect(screen.getByRole('status').textContent).toBe("Continue WatchingYou're offline");
  });
});
