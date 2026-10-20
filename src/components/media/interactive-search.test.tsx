// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Release } from '@/types';

const mocks = vi.hoisted(() => ({
  toast: { success: vi.fn(), error: vi.fn() },
  notFound: vi.fn(() => { throw new Error('NEXT_NOT_FOUND'); }),
}));
vi.mock('next/navigation', () => ({ notFound: mocks.notFound }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ back: vi.fn(), push: vi.fn() }) }));
vi.mock('sonner', () => ({ toast: mocks.toast }));

import { InteractiveSearch } from './interactive-search';
import { refreshAfterReconnect } from '@/lib/reconnect-queries';

const URL_ = '/api/radarr/release?movieId=5&instanceId=rad-1';

function release(guid: string, title: string, size: number, extra: Partial<Release> = {}): Release {
  return {
    guid, title, size, indexerId: 3, indexer: 'Nyaa', protocol: 'torrent', seeders: 10, leechers: 1, age: 2,
    ageHours: 48, ageMinutes: 2880, quality: { quality: { id: 1, name: 'Bluray-1080p' } }, qualityWeight: 10,
    releaseGroup: 'GRP', approved: true, rejected: false, rejections: [], downloadUrl: '', infoUrl: '', indexerFlags: 0,
    ...extra,
  };
}
const RELEASES = [
  release('a', 'Movie.2026.1080p.Small', 1_000_000_000),
  release('b', 'Movie.2026.2160p.Big', 9_000_000_000, { quality: { quality: { id: 2, name: 'Bluray-2160p' } }, qualityWeight: 20 }),
];

let fetchMock: ReturnType<typeof vi.fn>;
let searchResponse: () => Response;
let client: QueryClient;

beforeAll(() => {
  globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;
});
beforeEach(() => {
  vi.clearAllMocks();
  searchResponse = () => Response.json(RELEASES);
  fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (init?.method === 'POST') return Response.json({ success: true });
    if (url.startsWith('/api/radarr/downloadclient')) {
      return Response.json([
        { id: 1, name: 'qBittorrent', enable: true, protocol: 'torrent', priority: 1, implementation: 'QBittorrent' },
        { id: 2, name: 'Disabled', enable: false, protocol: 'torrent', priority: 1, implementation: 'QBittorrent' },
      ]);
    }
    return searchResponse();
  });
  vi.stubGlobal('fetch', fetchMock);
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function renderSearch(searchParams: Record<string, string | number> = { movieId: '5', instanceId: 'rad-1' }, seasonPacks = false) {
  return render(
    <QueryClientProvider client={client}>
      <InteractiveSearch service="radarr" subtitle="Movie (2026)" searchParams={searchParams} showSeasonPackFilter={seasonPacks} />
    </QueryClientProvider>,
  );
}
const searches = () => fetchMock.mock.calls.filter(([url, init]) => url === URL_ && !init?.method).length;
const titles = () => screen.getAllByText(/^Movie\.2026\./).map((el) => el.textContent);

describe('InteractiveSearch page', () => {
  it('searches the indexers as soon as it opens and lists the results, best quality first', async () => {
    renderSearch();
    expect(screen.getByRole('heading', { name: 'Interactive Search' })).toBeTruthy();
    expect(screen.getByText('Movie (2026)')).toBeTruthy();
    expect(screen.getByRole('status', { name: 'Searching indexers' })).toBeTruthy();
    await screen.findByText('Movie.2026.2160p.Big');
    expect(searches()).toBe(1);
    expect(titles()).toEqual(['Movie.2026.2160p.Big', 'Movie.2026.1080p.Small']);
    expect(screen.getByText('2 results')).toBeTruthy();
  });

  it('filters by text and re-sorts', async () => {
    const user = userEvent.setup();
    renderSearch();
    await screen.findByText('Movie.2026.2160p.Big');
    await user.click(screen.getByRole('button', { name: 'Size' }));
    expect(titles()).toEqual(['Movie.2026.2160p.Big', 'Movie.2026.1080p.Small']);
    await user.click(screen.getByRole('button', { name: 'Size' }));
    expect(titles()).toEqual(['Movie.2026.1080p.Small', 'Movie.2026.2160p.Big']);
    await user.type(screen.getByPlaceholderText('Filter releases...'), 'small');
    expect(titles()).toEqual(['Movie.2026.1080p.Small']);
    expect(screen.getByText('1 / 2')).toBeTruthy();
  });

  it('grabs a release on the same instance', async () => {
    const user = userEvent.setup();
    renderSearch();
    const row = (await screen.findByText('Movie.2026.1080p.Small')).closest('.rounded-lg') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Added to download queue'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(post[0]).toBe(URL_);
    expect(JSON.parse(String(post[1].body))).toEqual({ guid: 'a', indexerId: 3 });
  });

  it('grabs with another download client from the override dialog', async () => {
    const user = userEvent.setup();
    renderSearch();
    const row = (await screen.findByText('Movie.2026.2160p.Big')).closest('.rounded-lg') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Override and add to download queue' }));
    const dialog = await screen.findByRole('dialog', { name: 'Override Download Client' });
    await user.click(await within(dialog).findByRole('button', { name: /qBittorrent/ }));
    expect(within(dialog).queryByText('Disabled')).toBeNull();
    await user.click(within(dialog).getByRole('button', { name: 'Grab with Override' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalledWith('Added to download queue'));
    const post = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(String(post[1].body))).toEqual({ guid: 'b', indexerId: 3, downloadClientId: 1 });
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Override Download Client' })).toBeNull());
  });

  it('says when the search failed, and Try again searches again', async () => {
    const user = userEvent.setup();
    searchResponse = () => new Response('{}', { status: 500 });
    renderSearch();
    await screen.findByText('Search failed');
    searchResponse = () => Response.json(RELEASES);
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    await screen.findByText('Movie.2026.2160p.Big');
    expect(searches()).toBe(2);
  });

  it('says when nothing was found', async () => {
    searchResponse = () => Response.json([]);
    renderSearch();
    await screen.findByText('No releases found');
  });

  it('searches again from the header', async () => {
    const user = userEvent.setup();
    renderSearch();
    await screen.findByText('Movie.2026.2160p.Big');
    await user.click(screen.getByRole('button', { name: 'Search again' }));
    await waitFor(() => expect(searches()).toBe(2));
  });

  it('shows the same results without searching again when the user comes back to the page', async () => {
    const first = renderSearch();
    await screen.findByText('Movie.2026.2160p.Big');
    first.unmount();
    renderSearch();
    expect(screen.getByText('Movie.2026.2160p.Big')).toBeTruthy();
    expect(searches()).toBe(1);
  });

  it('is a 404 for an id that is not a whole number, without searching', () => {
    expect(() => renderSearch({ movieId: '5abc' })).toThrow('NEXT_NOT_FOUND');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('searches afresh on the next visit after a grab, keeping the list on screen', async () => {
    const user = userEvent.setup();
    const first = renderSearch();
    const row = (await screen.findByText('Movie.2026.1080p.Small')).closest('.rounded-lg') as HTMLElement;
    await user.click(within(row).getByRole('button', { name: 'Add to download queue' }));
    await waitFor(() => expect(mocks.toast.success).toHaveBeenCalled());
    expect(screen.getByText('Movie.2026.1080p.Small')).toBeTruthy();
    expect(searches()).toBe(1);
    first.unmount();
    renderSearch();
    await waitFor(() => expect(searches()).toBe(2));
  });

  it('is not searched again behind the user when the connection comes back', async () => {
    renderSearch();
    await screen.findByText('Movie.2026.2160p.Big');
    // Five minutes later the results are stale; a reconnect refreshes stale reads.
    await client.invalidateQueries({ refetchType: 'none' });
    await refreshAfterReconnect(client, '/movies/5/search', new AbortController().signal);
    expect(searches()).toBe(1);
    expect(screen.getByText('Movie.2026.2160p.Big')).toBeTruthy();
  });

  it('does not retry a failed search on its own, even where queries retry by default', async () => {
    client = new QueryClient({ defaultOptions: { queries: { retry: 3, retryDelay: 0 } } });
    searchResponse = () => new Response('{}', { status: 500 });
    renderSearch();
    await screen.findByText('Search failed');
    expect(searches()).toBe(1);
  });

  it('offers the Season Pack filter only on a season search', async () => {
    const user = userEvent.setup();
    const filterButton = () => document.querySelector('button:has(svg.lucide-arrow-up-down)') as HTMLElement;
    const first = renderSearch(undefined, true);
    await screen.findByText('Movie.2026.2160p.Big');
    await user.click(filterButton());
    expect(await screen.findByRole('menuitemradio', { name: 'Season Pack' })).toBeTruthy();
    await user.keyboard('{Escape}');
    first.unmount();
    client.clear();
    renderSearch();
    await screen.findByText('Movie.2026.2160p.Big');
    await user.click(filterButton());
    await screen.findByRole('menuitemcheckbox', { name: 'All Indexers' });
    expect(screen.queryByRole('menuitemradio', { name: 'Season Pack' })).toBeNull();
  });

  it('pins the filters below the whole header, padding included', async () => {
    renderSearch();
    const filters = (await screen.findByPlaceholderText('Filter releases...')).closest('.page-toolbar') as HTMLElement;
    expect(filters.style.top).toBe('calc(var(--header-height, 0px) + var(--main-pad-top) + 2.75rem)');
  });
});
