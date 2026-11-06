// @vitest-environment jsdom

import { act, render } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  pullToRefresh: null as null | { onRefresh: () => unknown; disabled?: boolean },
  expandSearch: null as null | ((expanded: boolean) => void),
  viewer: vi.fn(async () => ({ connected: false })),
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({
  PullToRefresh: (props: { onRefresh: () => unknown; disabled?: boolean }) => {
    mocks.pullToRefresh = props;
    return null;
  },
}));
vi.mock('@/components/anime/anime-search-overlay', () => ({
  AnimeSearchOverlay: ({ onExpandedChange }: { onExpandedChange: (expanded: boolean) => void }) => {
    mocks.expandSearch = onExpandedChange;
    return null;
  },
}));
vi.mock('@/components/anime/anime-media-rail', () => ({ AnimeMediaRail: () => null }));
vi.mock('@/components/hero-carousel', () => ({ HeroCarousel: () => null }));
vi.mock('@/components/ui/app-link', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/components/permission-provider', () => ({ useMe: () => ({ role: 'admin' }) }));
vi.mock('@/lib/anilist-viewer', () => ({ fetchAnilistViewer: mocks.viewer }));

import AnimeHome from './anime-home';

let fetchMock: ReturnType<typeof vi.fn<(url: string) => Promise<Response>>>;
beforeEach(() => {
  fetchMock = vi.fn(async () => Response.json({}));
  vi.stubGlobal('fetch', fetchMock);
});

it('pull to refresh refetches the anime shelves and the AniList account, off while searching', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><AnimeHome /></QueryClientProvider>);
  await vi.waitFor(() => expect(client.isFetching()).toBe(0));
  const homeFetches = () => fetchMock.mock.calls.filter(([url]) => url.startsWith('/api/anime/home')).length;
  expect(homeFetches()).toBe(1);
  expect(mocks.viewer).toHaveBeenCalledTimes(1);

  expect(mocks.pullToRefresh!.disabled).toBe(false);
  await act(async () => { await mocks.pullToRefresh!.onRefresh(); });
  expect(homeFetches()).toBe(2);
  expect(mocks.viewer).toHaveBeenCalledTimes(2);

  act(() => mocks.expandSearch!(true));
  expect(mocks.pullToRefresh!.disabled).toBe(true);
});
