// @vitest-environment jsdom

import { useState, type ComponentProps, type ReactNode } from 'react';
import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CalendarEvent } from '@/types';

const mocks = vi.hoisted(() => ({ urls: [] as string[], data: [] as unknown[] }));
vi.mock('@/lib/query-fetch', () => ({
  jsonFetcher: (url: string) => { mocks.urls.push(url); return async () => []; },
}));
vi.mock('@tanstack/react-query', () => ({ useQuery: () => ({ data: mocks.data, isLoading: false }) }));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('@/lib/hooks/use-route-view-state', () => ({ useRouteViewState: <T,>(_key: string, initial: T) => useState(initial) }));
vi.mock('@/lib/hooks/use-watch-skin', () => ({ useWatchSkin: () => 'classic' }));
vi.mock('@/lib/hooks/use-compact-viewport', () => ({ useCompactViewport: () => false }));
vi.mock('@/components/media/fade-in-image', () => ({ FadeInImage: () => null }));
vi.mock('@/components/ui/app-link', () => ({ default: (props: ComponentProps<'a'>) => <a {...props} /> }));
vi.mock('@/components/jellyfin-streaming/media-rail', () => ({ MediaRail: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/components/jellyfin-streaming/media-tile', () => ({ MediaTile: () => null }));

import { NewAndHot } from './cinematic/new-and-hot';
import { UpcomingRails, airsAt } from './upcoming-rails';

const ev = (id: string, type: CalendarEvent['type'], date: string): CalendarEvent => ({
  id, type, title: id, subtitle: 'sub', date, hasFile: false, monitored: true, images: [],
  ...(type === 'movie' ? { movieId: 1, releaseType: 'digital' as const } : { seriesId: 1 }),
});

afterEach(() => {
  vi.unstubAllEnvs();
  mocks.urls = [];
  mocks.data = [];
});

describe('Watch calendar rails', () => {
  it.each([
    ['the Upcoming rails', () => <UpcomingRails />],
    ['New & Hot', () => <NewAndHot railsFallback={null} />],
  ])("%s ask for this device's days, as Calendar does", (_name, ui) => {
    render(ui());
    const url = new URL(mocks.urls.at(-1)!, 'http://localhost');
    expect(url.searchParams.get('tz')).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
  });

  it("New & Hot lists by this device's day: a Nov 20 film after the evening before's episode in Los Angeles", () => {
    vi.stubEnv('TZ', 'America/Los_Angeles');
    mocks.data = [ev('Nov 20 film', 'movie', '2099-11-20T00:00:00Z'), ev('Nov 19 evening episode', 'episode', '2099-11-20T04:00:00Z')];
    render(<NewAndHot railsFallback={null} />);
    const text = document.body.textContent!;
    expect(text.indexOf('Nov 19 evening episode')).toBeLessThan(text.indexOf('Nov 20 film'));
    expect(screen.getAllByText('Nov 20 film').length).toBeGreaterThan(0);
  });

  it("dates a film by its day only, even where that day's midnight does not exist (Santiago's DST start)", () => {
    vi.stubEnv('TZ', 'America/Santiago');
    const label = airsAt(ev('Spring film', 'movie', '2026-09-06T00:00:00Z'))!;
    expect(label).toMatch(/6/);
    expect(label).not.toMatch(/\d:\d\d/);
  });
});
