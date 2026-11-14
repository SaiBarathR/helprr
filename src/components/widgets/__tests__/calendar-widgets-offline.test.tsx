// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// The widgets hand their fetcher to useWidgetData; keep it to call it here.
const mocks = vi.hoisted(() => ({ fetchFns: [] as Array<() => Promise<unknown>> }));
vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: ({ fetchFn }: { fetchFn: () => Promise<unknown> }) => {
    mocks.fetchFns.push(fetchFn);
    return { data: [], loading: false };
  },
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 366, height: 300 }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10 }) }));
vi.mock('../dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

import { TodayCalendarWidget } from '../today-calendar-widget';
import { UpcomingWidget } from '../upcoming-widget';
import { getBrowseFreshness } from '@/lib/browse-freshness';

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  vi.unstubAllGlobals();
  mocks.fetchFns = [];
});

describe.each([
  ['Today', () => <TodayCalendarWidget refreshInterval={60} />],
  ['Upcoming', () => <UpcomingWidget refreshInterval={60} />],
])('%s widget offline', (_name, widget) => {
  it("reports the worker's saved copy to the shared saved-data notice, and a live answer clears it", async () => {
    render(widget());
    const fetchFn = mocks.fetchFns.at(-1)!;
    const savedAt = Date.now() - 60_000;
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([], {
      headers: { 'x-helprr-stale': '1', 'x-helprr-snapshot-at': String(savedAt) },
    })));
    await fetchFn();
    expect(getBrowseFreshness()).toBe(savedAt);

    vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
    await fetchFn();
    expect(getBrowseFreshness()).toBe(0);
  });
});
