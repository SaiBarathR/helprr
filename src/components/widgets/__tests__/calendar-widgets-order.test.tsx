// @vitest-environment jsdom

import type { ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

// The widgets hand their fetcher to useWidgetData; keep it, and serve `data`.
const mocks = vi.hoisted(() => ({
  fetchFns: [] as Array<() => Promise<unknown>>,
  data: [] as unknown[],
}));
vi.mock('@/lib/widgets/use-widget-data', () => ({
  useWidgetData: ({ fetchFn }: { fetchFn: () => Promise<unknown> }) => {
    mocks.fetchFns.push(fetchFn);
    return { data: mocks.data, loading: false, error: null, offline: false };
  },
}));
vi.mock('@/lib/widgets/use-element-size', () => ({ useElementSize: () => ({ ref: () => {}, width: 366, height: 300 }) }));
vi.mock('@/lib/widgets/use-list-fetch-size', () => ({ useListFetchSize: () => ({ visibleCount: 10 }) }));
vi.mock('../dashboard-layout-context', () => ({ useDashboardLayout: () => ({ setWidgetLayoutOverride: vi.fn() }) }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children, ...props }: { children: ReactNode }) => <a {...props}>{children}</a> }));

import { TodayCalendarWidget } from '../today-calendar-widget';
import { UpcomingWidget } from '../upcoming-widget';

const ev = (id: string, type: CalendarEvent['type'], date: string): CalendarEvent => ({
  id, type, title: id, subtitle: 'sub', date, hasFile: false, monitored: true, images: [],
  ...(type === 'movie' ? { movieId: 1, releaseType: 'digital' as const } : { seriesId: 1 }),
});

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  mocks.fetchFns = [];
  mocks.data = [];
});

describe.each([
  ['Today', () => <TodayCalendarWidget refreshInterval={60} />],
  ['Upcoming', () => <UpcomingWidget refreshInterval={60} />],
])('%s widget order', (_name, widget) => {
  it("lists by this device's day, all-day first: a Nov 20 film after the evening before's episode in Los Angeles", async () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    render(widget());
    // Upstream order by instant: the film's UTC midnight (Nov 19 16:00 here) before the 20:00 episode.
    vi.stubGlobal('fetch', vi.fn(async () => Response.json([
      ev('film', 'movie', '2026-11-20T00:00:00Z'),
      ev('evening-episode', 'episode', '2026-11-20T04:00:00Z'),
      ev('next-day-episode', 'episode', '2026-11-20T18:00:00Z'),
    ])));
    const list = (await mocks.fetchFns.at(-1)!()) as CalendarEvent[];
    expect(list.map((e) => e.id)).toEqual(['evening-episode', 'film', 'next-day-episode']);
  });
});

describe('Upcoming widget dates', () => {
  it("gives a film its day only, even where that day's midnight does not exist (Santiago's DST start)", () => {
    vi.stubEnv('TZ', 'America/Santiago');
    // Local midnight on 2026-09-06 is skipped; the day starts at 01:00.
    mocks.data = [ev('Spring film', 'movie', '2026-09-06T00:00:00Z')];
    render(<UpcomingWidget refreshInterval={60} layoutVariant="list" />);
    const row = screen.getAllByText('Spring film')[0].closest('a')!;
    expect(row.textContent).toMatch(/Sep 6/);
    expect(row.textContent).not.toMatch(/\d:\d\d/);
  });
});
