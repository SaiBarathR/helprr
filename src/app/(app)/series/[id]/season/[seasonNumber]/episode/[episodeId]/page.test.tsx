// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7', seasonNumber: '4', episodeId: '101' }),
  useSearchParams: () => new URLSearchParams('instance=son-1'),
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: vi.fn(), replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/permission-provider', () => ({ useCan: () => true }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/jellyfin/use-series-episode-watch', () => ({
  useSeriesEpisodeWatch: () => ({ episodes: {}, jellyfinSeriesId: null }),
}));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertDialog: () => null }));
vi.mock('@/components/media/interactive-search-dialog', () => ({ InteractiveSearchDialog: () => null }));
import EpisodeDetailPage from './page';

const SERIES = {
  id: 7, title: 'Ted Lasso', seriesType: 'anime', tmdbId: 0, tvdbId: 1,
  seasons: [{ seasonNumber: 4, monitored: true, statistics: { sizeOnDisk: 0 } }],
};
const EPISODES = [
  { id: 101, seriesId: 7, seasonNumber: 4, episodeNumber: 1, title: 'Home', monitored: true, hasFile: false, airDate: '2026-08-05' },
];

let root: Root;
let queryClient: QueryClient;
let commands: Record<string, unknown>[];
let commandResponse: () => Response;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  commands = [];
  commandResponse = () => Response.json({ id: 1 });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      commands.push(JSON.parse(String(init.body)));
      return commandResponse();
    }
    if (url.startsWith('/api/sonarr/7/episodes')) return Response.json(EPISODES);
    if (url.startsWith('/api/sonarr/7')) return Response.json(SERIES);
    if (url.startsWith('/api/activity/history')) return Response.json({ records: [] });
    return Response.json({});
  }));
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  document.body.innerHTML = '<div id="root"></div>';
  root = createRoot(document.getElementById('root')!);
});
afterEach(async () => {
  await act(async () => root.unmount());
  queryClient.clear();
  vi.unstubAllGlobals();
});

const wait = (ms: number) => act(async () => { await new Promise((done) => setTimeout(done, ms)); });
async function waitFor(check: () => void, timeout = 3000) {
  for (const start = Date.now(); ; await wait(10)) {
    try {
      check();
      return;
    } catch (error) {
      if (Date.now() - start > timeout) throw error;
    }
  }
}
async function clickAutomatic() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><EpisodeDetailPage /></QueryClientProvider>));
  await waitFor(() => expect([...document.querySelectorAll('button')].some((b) => b.textContent === 'Automatic')).toBe(true));
  const automatic = [...document.querySelectorAll('button')].find((b) => b.textContent === 'Automatic')!;
  await act(async () => automatic.click());
}

describe('episode page automatic search', () => {
  it('confirms a search Sonarr accepted', async () => {
    await clickAutomatic();
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Episode search started'));
    expect(commands).toEqual([{ name: 'EpisodeSearch', episodeIds: [101] }]);
  });

  it('reports a rejected search instead of claiming it started', async () => {
    commandResponse = () => new Response('nope', { status: 500 });
    await clickAutomatic();
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Search failed'));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });
});
