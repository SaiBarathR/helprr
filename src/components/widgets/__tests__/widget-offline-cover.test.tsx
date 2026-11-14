// @vitest-environment jsdom

import type { ComponentType } from 'react';
import { act, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { WidgetAvailabilityProvider } from '@/lib/widgets/widget-availability-context';
import { getBrowseFreshness } from '@/lib/browse-freshness';
import { SNAPSHOT_STALE_HEADER, SNAPSHOT_TIME_HEADER } from '@/lib/offline-snapshot';
import type { WidgetDefinition, WidgetProps } from '@/lib/widgets/types';

const mocks = vi.hoisted(() => ({ component: null as ComponentType<WidgetProps> | null, name: '', interval: 30 }));

vi.mock('@/lib/store', () => ({
  useUIStore: (selector: (state: { discoverLayout: null }) => unknown) => selector({ discoverLayout: null }),
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 300, height: 120 }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));
vi.mock('@/lib/widgets/registry', () => ({
  getWidgetDefinition: (id: string): WidgetDefinition => ({
    id,
    name: mocks.name,
    description: '',
    icon: 'BarChart3',
    category: 'overview',
    defaultDesktopSpan: { colSpan: 4, rowSpan: 1 },
    defaultMobileSpan: { colSpan: 2, rowSpan: 1 },
    defaultRefreshIntervalSecs: mocks.interval,
  }),
}));
vi.mock('../widget-loaders', () => ({
  getWidgetComponent: () => mocks.component,
  resetWidgetComponent: () => {},
}));

import { WidgetRenderer } from '../widget-renderer';
import { TorrentWidget } from '../torrent-widget';
import { ProwlarrIndexersWidget } from '../prowlarr-indexers-widget';
import { WantedItemsWidget } from '../wanted-items-widget';
import { fetchSectionsCached } from '../discover-section-widget';
import { useWidgetData } from '@/lib/widgets/use-widget-data';

const NOW = Date.UTC(2026, 10, 14, 12, 0, 0);

function json(body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
}

async function show(name: string, component: ComponentType<WidgetProps>, fetchImpl: (url: string) => Promise<Response>) {
  mocks.name = name;
  mocks.component = component;
  vi.stubGlobal('fetch', vi.fn((url: string) => fetchImpl(String(url))));
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const view = render(
    <QueryClientProvider client={client}>
      <WidgetAvailabilityProvider services={[]}>
        <WidgetRenderer instance={{ id: `${name}-1`, widgetId: name, colSpan: 4, rowSpan: 1 }} rowSpan={1} />
      </WidgetAvailabilityProvider>
    </QueryClientProvider>,
  );
  await act(async () => vi.advanceTimersByTimeAsync(0));
  return { client, view };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] });
  vi.setSystemTime(NOW);
});

afterEach(() => {
  mocks.interval = 30;
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

const unreachable = () => Promise.reject(new TypeError('Failed to fetch'));

describe('dashboard widgets with Helprr out of reach', () => {
  it('Torrents says it cannot reach Helprr instead of showing 0 torrents', async () => {
    await show('Torrents', TorrentWidget, unreachable);
    expect(screen.getByRole('status').textContent).toBe('TorrentsCan’t reach Helprr right now.');
  });

  it('Indexers says so too: a network failure no longer reads as "0 indexers"', async () => {
    await show('Indexers', ProwlarrIndexersWidget, unreachable);
    expect(screen.getByRole('status').textContent).toBe('IndexersCan’t reach Helprr right now.');
  });

  it('says "You\'re offline" when the device is offline', async () => {
    vi.stubGlobal('navigator', { ...navigator, onLine: false });
    await show('Torrents', TorrentWidget, unreachable);
    expect(screen.getByRole('status').textContent).toBe("TorrentsYou're offline");
  });

  it('a live answer shows the widget with no cover', async () => {
    await show('Wanted', WantedItemsWidget, async () => json({ missingTotal: 21, cutoffTotal: 47 }));
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent).toContain('21');
    expect(getBrowseFreshness()).toBe(0);
  });

  it("Wanted shows the worker's saved copy with the shared notice, then the out-of-reach state five minutes after it was saved", async () => {
    const savedAt = NOW - 4 * 60_000;
    // The mock keeps answering with the copy, so only its age can hide it.
    await show('Wanted', WantedItemsWidget, async () => {
      return json({ missingTotal: 21, cutoffTotal: 47 }, { [SNAPSHOT_STALE_HEADER]: '1', [SNAPSHOT_TIME_HEADER]: String(savedAt) });
    });
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent).toContain('21');
    expect(getBrowseFreshness()).toBe(savedAt);

    await act(async () => vi.advanceTimersByTimeAsync(59_000));
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(1_000));
    expect(screen.getByRole('status').textContent).toBe('WantedCan’t reach Helprr right now.');
    expect(getBrowseFreshness()).toBe(0);
  });

  it('a live widget with data on screen survives one failed poll, and is covered after two in a row', async () => {
    let up = true;
    const live = { total: 3, downloading: 1, seeding: 2, paused: 0 };
    await show('Torrents', TorrentWidget, () => (up ? Promise.resolve(json(live)) : unreachable()));
    expect(screen.queryByRole('status')).toBeNull();
    up = false;
    await act(async () => vi.advanceTimersByTimeAsync(30_100));
    expect(screen.queryByRole('status')).toBeNull();
    await act(async () => vi.advanceTimersByTimeAsync(30_100));
    expect(screen.getByRole('status').textContent).toBe('TorrentsCan’t reach Helprr right now.');
    up = true;
    await act(async () => vi.advanceTimersByTimeAsync(30_100));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it("a TypeError from the widget's own code is not taken for an unreachable Helprr", async () => {
    // A 200 with a body the fetcher can't read: `data.transferInfo` on null.
    await show('Torrents', TorrentWidget, async () => json(null));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('online, an expiring saved copy is asked for once more, and a live answer keeps the widget up', async () => {
    mocks.interval = 300;
    const savedAt = NOW - 4 * 60_000;
    let calls = 0;
    await show('Wanted', WantedItemsWidget, async () => {
      calls += 1;
      return calls === 1
        ? json({ missingTotal: 21, cutoffTotal: 47 }, { [SNAPSHOT_STALE_HEADER]: '1', [SNAPSHOT_TIME_HEADER]: String(savedAt) })
        : json({ missingTotal: 22, cutoffTotal: 47 });
    });
    expect(getBrowseFreshness()).toBe(savedAt);
    await act(async () => vi.advanceTimersByTimeAsync(60_100));
    expect(calls).toBe(2);
    expect(screen.queryByRole('status')).toBeNull();
    expect(document.body.textContent).toContain('22');
    expect(getBrowseFreshness()).toBe(0);
  });

  it("leaving the dashboard takes the widget's saved copy out of the notice", async () => {
    const savedAt = NOW - 60_000;
    const { view } = await show('Wanted', WantedItemsWidget, async () =>
      json({ missingTotal: 21, cutoffTotal: 47 }, { [SNAPSHOT_STALE_HEADER]: '1', [SNAPSHOT_TIME_HEADER]: String(savedAt) }));
    expect(getBrowseFreshness()).toBe(savedAt);
    view.unmount();
    expect(getBrowseFreshness()).toBe(0);
  });

  it("Discover's reused in-memory response keeps its saved copy, so it still expires at five minutes", async () => {
    const savedAt = NOW - 4 * 60_000;
    function Sections({ refreshInterval }: WidgetProps) {
      const { data } = useWidgetData({ fetchFn: (signal) => fetchSectionsCached(20, signal), refreshInterval, cacheKey: 'discover-test' });
      return <span>{data ? 'sections' : 'none'}</span>;
    }
    let calls = 0;
    const { client } = await show('Discover', Sections, async () => {
      calls += 1;
      return json({ sections: [] }, { [SNAPSHOT_STALE_HEADER]: '1', [SNAPSHOT_TIME_HEADER]: String(savedAt) });
    });
    // The pill's Retry: a second load inside Discover's 5-minute promise cache.
    await act(async () => client.invalidateQueries({ queryKey: ['widget-data'] }));
    expect(calls).toBe(1);
    expect(document.body.textContent).toContain('sections');
    expect(getBrowseFreshness()).toBe(savedAt);
    // The expiry's own refetch reuses the cached response too, so the copy stays expired.
    await act(async () => vi.advanceTimersByTimeAsync(60_100));
    expect(screen.getByRole('status').textContent).toBe('DiscoverCan’t reach Helprr right now.');
    expect(getBrowseFreshness()).toBe(0);
  });
});
