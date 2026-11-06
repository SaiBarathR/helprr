// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  canManage: true,
  search: new URLSearchParams(),
  toast: { success: vi.fn(), error: vi.fn() },
}));
vi.mock('next/navigation', () => ({ useSearchParams: () => mocks.search, usePathname: () => '/activity' }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/components/permission-provider', () => ({
  useCan: (cap: string) => cap !== 'activity.manage' || mocks.canManage,
}));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { WantedTab } from '../wanted-tab';

const YEAR = 365 * 24 * 60 * 60 * 1000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ahead = (ms: number) => new Date(Date.now() + ms).toISOString();

const RECORDS = [
  { id: 11, source: 'sonarr', mediaType: 'episode', instanceId: 'son-1', seriesId: 5, seasonNumber: 1, episodeNumber: 8, title: 'Ep 8', series: { id: 5, title: 'Classroom' }, airDateUtc: ago(9 * YEAR) },
  { id: 12, source: 'sonarr', mediaType: 'episode', instanceId: 'son-2', seriesId: 6, seasonNumber: 2, episodeNumber: 1, title: 'Ep 1', series: { id: 6, title: 'Other Show' }, airDateUtc: ago(YEAR) },
  { id: 21, source: 'radarr', mediaType: 'movie', instanceId: 'rad-1', title: 'Out Film', year: 2024, isAvailable: true, digitalRelease: ago(2 * YEAR), added: ago(YEAR / 4) },
  { id: 22, source: 'radarr', mediaType: 'movie', instanceId: 'rad-1', title: 'Secret Wars', year: 2027, isAvailable: false, inCinemas: ahead(YEAR), added: ago(YEAR) },
];
const INSTANCES = [
  { id: 'son-1', label: 'main', type: 'SONARR' },
  { id: 'son-2', label: 'anime', type: 'SONARR' },
  { id: 'rad-1', label: 'main', type: 'RADARR' },
  { id: 'jf-1', label: 'jf', type: 'JELLYFIN' },
];

let posts: Array<{ url: string; body: unknown }>;
const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
  if (init?.method === 'POST') {
    posts.push({ url, body: JSON.parse(String(init.body)) });
    return Response.json({ id: 1 });
  }
  if (url === '/api/instances') return Response.json(INSTANCES);
  if (url.startsWith('/api/activity/wanted?')) return Response.json({ records: RECORDS, totalRecords: 42 });
  return Response.json({});
});

beforeEach(() => {
  mocks.canManage = true;
  posts = [];
  fetchMock.mockClear();
  mocks.toast.success.mockClear();
  mocks.toast.error.mockClear();
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

function renderTab(props: Partial<{ type: 'missing' | 'cutoff'; filterBy: string[]; instanceFilter: string }> = {}) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <WantedTab type="missing" filterBy={[]} instanceFilter="all" {...props} />
    </QueryClientProvider>,
  );
}

describe('WantedTab', () => {
  it('labels each row\'s date by what it means', async () => {
    renderTab();
    expect(await screen.findByText(/Classroom - S01E08/)).toBeTruthy();
    expect(screen.getByText(/^Aired .*9 years ago$/)).toBeTruthy();
    expect(screen.getByText(/^Digital release .*2 years ago$/)).toBeTruthy();
  });

  it('folds films that are not released yet into their own group on Missing', async () => {
    renderTab();
    await screen.findByText(/Classroom - S01E08/);
    expect(screen.queryByText('Secret Wars (2027)')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'Not released yet (1)' }));
    expect(screen.getByText('Secret Wars (2027)')).toBeTruthy();
    expect(screen.getByText(/^In cinemas in /)).toBeTruthy();
  });

  it('keeps every film in the main list on Cutoff Unmet', async () => {
    renderTab({ type: 'cutoff' });
    expect(await screen.findByText('Secret Wars (2027)')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Not released yet/ })).toBeNull();
  });

  it('searches a selection with one command per app and instance', async () => {
    renderTab();
    await screen.findByText(/Classroom - S01E08/);
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByText(/Classroom - S01E08/));
    await userEvent.click(screen.getByText(/Other Show - S02E01/));
    await userEvent.click(screen.getByText('Out Film (2024)'));
    expect(screen.getByText('3 selected')).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: 'Search selected' }));
    await waitFor(() => expect(posts).toHaveLength(3));
    expect(posts).toEqual(expect.arrayContaining([
      { url: '/api/sonarr/command?instanceId=son-1', body: { name: 'EpisodeSearch', episodeIds: [11] } },
      { url: '/api/sonarr/command?instanceId=son-2', body: { name: 'EpisodeSearch', episodeIds: [12] } },
      { url: '/api/radarr/command?instanceId=rad-1', body: { name: 'MoviesSearch', movieIds: [21] } },
    ]));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Search started for 3 items'));
  });

  it('searches all only after a confirm that shows the count, on each covered instance', async () => {
    renderTab({ filterBy: ['sonarr'] });
    await screen.findByText(/Classroom - S01E08/);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Search all' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Search all' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText('Search for all 42 missing items?')).toBeTruthy();
    expect(within(dialog).queryByText(/Radarr also searches/)).toBeNull();
    expect(posts).toEqual([]);

    await userEvent.click(within(dialog).getByRole('button', { name: 'Search all' }));
    await waitFor(() => expect(posts).toHaveLength(2));
    expect(posts).toEqual([
      { url: '/api/sonarr/command?instanceId=son-1', body: { name: 'MissingEpisodeSearch' } },
      { url: '/api/sonarr/command?instanceId=son-2', body: { name: 'MissingEpisodeSearch' } },
    ]);
  });

  it('warns that Radarr also searches unreleased films when Search all covers Radarr', async () => {
    renderTab();
    await screen.findByText(/Classroom - S01E08/);
    await waitFor(() => expect((screen.getByRole('button', { name: 'Search all' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Search all' }));
    expect(within(await screen.findByRole('alertdialog')).getByText(/Radarr also searches films that are not released yet/)).toBeTruthy();
  });

  it('drops the selection when the filters change', async () => {
    const view = renderTab();
    await screen.findByText(/Classroom - S01E08/);
    await userEvent.click(screen.getByRole('button', { name: 'Select' }));
    await userEvent.click(screen.getByText(/Classroom - S01E08/));
    expect(screen.getByText('1 selected')).toBeTruthy();
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    view.rerender(
      <QueryClientProvider client={client}>
        <WantedTab type="missing" filterBy={['sonarr']} instanceFilter="all" />
      </QueryClientProvider>,
    );
    await screen.findByText(/Classroom - S01E08/);
    expect(screen.queryByText('1 selected')).toBeNull();
  });

  it('searches all cutoff unmet on the one filtered instance', async () => {
    renderTab({ type: 'cutoff', instanceFilter: 'rad-1' });
    await screen.findByText('Out Film (2024)');
    await waitFor(() => expect((screen.getByRole('button', { name: 'Search all' }) as HTMLButtonElement).disabled).toBe(false));
    await userEvent.click(screen.getByRole('button', { name: 'Search all' }));
    await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Search all' }));
    await waitFor(() => expect(posts).toEqual([
      { url: '/api/radarr/command?instanceId=rad-1', body: { name: 'CutoffUnmetMoviesSearch' } },
    ]));
  });

  it('shows no search or select actions without activity.manage', async () => {
    mocks.canManage = false;
    renderTab();
    await screen.findByText(/Classroom - S01E08/);
    expect(screen.queryByRole('button', { name: 'Select' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search all' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search for release' })).toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/instances')).toBe(false);
  });
});
