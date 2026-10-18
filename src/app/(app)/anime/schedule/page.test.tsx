// @vitest-environment jsdom

import { act, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/hooks/use-route-view-state', () => ({
  useRouteViewState: <T,>(_key: string, initial: T | (() => T)) => useState(initial),
}));
vi.mock('@/lib/route-scroll-state', () => ({ readRouteScrollState: () => null, routeScrollKey: () => 'k' }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => <a>{children}</a> }));
vi.mock('@/components/ui/page-spinner', () => ({ PageSpinner: () => <p>loading</p> }));
vi.mock('@/components/anime/anime-schedule-week-nav', () => ({ AnimeScheduleWeekNav: () => null }));
vi.mock('@/components/anime/anime-schedule-card', () => ({
  AnimeScheduleCard: ({ entry, now }: { entry: { episode: number; airingAt: number }; now: number }) => (
    <p data-episode={entry.episode}>{entry.airingAt < now ? 'aired' : 'upcoming'}</p>
  ),
}));

import AnimeSchedulePage from './page';

let root: Root;
let release: (() => void) | null = null;
let airingAt = 0;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-10-14T12:00:00'));
  Element.prototype.scrollIntoView = () => {};
  vi.stubGlobal('fetch', vi.fn((url: string) => new Promise<Response>((resolve) => {
    const params = new URL(url, 'http://helprr.test').searchParams;
    release = () => resolve(Response.json({
      weekStart: Number(params.get('weekStart')),
      weekEnd: Number(params.get('weekEnd')),
      entries: [{ media: { id: 1 }, episode: 5, airingAt }],
    }));
  })));
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(() => {
  act(() => root.unmount());
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

// Kept suppression (audit-w8 Batch B): "now" is re-anchored when a week's data
// lands, so an episode that aired while the request was in flight is not shown
// as upcoming until the next minute tick.
describe('AnimeSchedulePage', () => {
  it('re-anchors "now" when the week\'s data lands', async () => {
    const mountedAt = Math.floor(Date.now() / 1000);
    airingAt = mountedAt + 30;
    act(() => root.render(<QueryClientProvider client={new QueryClient()}><AnimeSchedulePage /></QueryClientProvider>));

    // The schedule answers 45 s later; the episode aired 15 s before that.
    vi.setSystemTime(new Date((mountedAt + 45) * 1000));
    await act(async () => {
      release?.();
      for (let i = 0; i < 5; i += 1) await new Promise((r) => setTimeout(r, 0));
    });

    expect(document.querySelector('[data-episode="5"]')?.textContent).toBe('aired');
  });
});
