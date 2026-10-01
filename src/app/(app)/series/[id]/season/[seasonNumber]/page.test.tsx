// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  caps: new Set<string>(),
  push: vi.fn(),
  toast: { success: vi.fn(), error: vi.fn() },
  interactiveTitles: [] as string[],
}));
vi.mock('next/navigation', () => ({
  useParams: () => ({ id: '7', seasonNumber: '4' }),
  useSearchParams: () => new URLSearchParams('instance=son-1'),
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: mocks.push, replace: vi.fn(), back: vi.fn() }),
}));
vi.mock('@/components/permission-provider', () => ({ useCan: (cap: string) => mocks.caps.has(cap) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));
vi.mock('@/components/jellyfin/use-series-episode-watch', () => ({ useSeriesEpisodeWatch: () => ({ episodes: {} }) }));
vi.mock('@/components/scheduled-alerts/scheduled-alert-dialog', () => ({ ScheduledAlertDialog: () => null }));
vi.mock('@/components/media/interactive-search-dialog', () => ({
  InteractiveSearchDialog: ({ open, title }: { open: boolean; title: string }) => {
    if (open) mocks.interactiveTitles.push(title);
    return null;
  },
}));
import SeasonDetailPage from './page';

const SERIES = {
  id: 7, title: 'Ted Lasso', seriesType: 'anime', tmdbId: 0, tvdbId: 1,
  seasons: [{ seasonNumber: 4, monitored: true, statistics: { sizeOnDisk: 0 } }],
};
const EPISODES = [
  { id: 101, seriesId: 7, seasonNumber: 4, episodeNumber: 1, title: 'Home', monitored: true, hasFile: false, airDate: '2026-08-05' },
  { id: 102, seriesId: 7, seasonNumber: 4, episodeNumber: 2, title: 'Curiouser and Curiouser!', monitored: true, hasFile: false, airDate: '2026-08-12' },
];

let root: Root;
let queryClient: QueryClient;
let commands: { url: string; body: Record<string, unknown> }[];
let commandResponse: () => Response;

beforeEach(() => {
  (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  vi.clearAllMocks();
  mocks.caps = new Set(['activity.manage', 'series.editMonitoring']);
  mocks.interactiveTitles = [];
  commands = [];
  commandResponse = () => Response.json({ id: 1 });
  vi.stubGlobal('fetch', vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') {
      commands.push({ url, body: JSON.parse(String(init.body)) });
      return commandResponse();
    }
    if (url.startsWith('/api/sonarr/7/episodes')) return Response.json(EPISODES);
    if (url.startsWith('/api/sonarr/7')) return Response.json(SERIES);
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
async function renderPage() {
  await act(async () => root.render(<QueryClientProvider client={queryClient}><SeasonDetailPage /></QueryClientProvider>));
  await waitFor(() => expect(document.body.textContent).toContain('Curiouser and Curiouser!'));
}
const button = (name: string) =>
  [...document.querySelectorAll('button')].find((b) => b.getAttribute('aria-label') === name);

describe('season page episode search buttons', () => {
  it('starts an automatic search for just that episode without opening it', async () => {
    await renderPage();
    await act(async () => button('Automatic search: Curiouser and Curiouser!')!.click());
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Episode 2 search started'));
    expect(commands).toEqual([{
      url: '/api/sonarr/command?instanceId=son-1',
      body: { name: 'EpisodeSearch', episodeIds: [102] },
    }]);
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('reports a rejected search instead of claiming it started', async () => {
    commandResponse = () => new Response('nope', { status: 500 });
    await renderPage();
    await act(async () => button('Automatic search: Home')!.click());
    await waitFor(() => expect(mocks.toast.error).toHaveBeenCalledWith('Episode 1 search failed'));
    expect(mocks.toast.success).not.toHaveBeenCalled();
  });

  it('opens interactive search for that episode', async () => {
    await renderPage();
    await act(async () => button('Interactive search: Home')!.click());
    await waitFor(() => expect(mocks.interactiveTitles).toContain('Ted Lasso - Season 4 - Home'));
    expect(mocks.push).not.toHaveBeenCalled();
  });

  it('hides the buttons from users who cannot manage downloads', async () => {
    mocks.caps = new Set(['series.editMonitoring']);
    await renderPage();
    expect(button('Automatic search: Home')).toBeUndefined();
    expect(button('Interactive search: Home')).toBeUndefined();
  });
});
