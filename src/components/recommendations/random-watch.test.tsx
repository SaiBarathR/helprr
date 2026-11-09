// @vitest-environment jsdom
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ replace: vi.fn(), jellyfin: false }));

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('@/components/layout/navigation-provider', () => ({ useAppRouter: () => ({ replace: mocks.replace }) }));
vi.mock('@/components/ui/app-link', () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => <a href={href}>{children}</a>,
}));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => ({ id: 'sai', jellyfinLinked: mocks.jellyfin }),
  hasCapability: () => mocks.jellyfin,
}));

import { RandomWatchView } from './random-watch';
import { useUIStore } from '@/lib/store';
import { DEFAULT_RANDOM_WATCH_PREFS, MAX_RANDOM_GENRES } from '@/lib/random-watch-filters';

// jsdom has no pointer capture, which the drawer asks for on a press inside it.
HTMLElement.prototype.setPointerCapture ??= () => {};
HTMLElement.prototype.releasePointerCapture ??= () => {};

const fetchMock = vi.fn(async (url: string) => {
  if (url === '/api/tonight/members') return Response.json({ members: [{ id: 'mum', name: 'Mum' }] });
  return Response.json({ pick: null, poolSize: 0, genres: ['Comedy', 'Drama'] });
});
const rollUrls = () => fetchMock.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/random-watch'));
const lastRoll = () => new URL(rollUrls().at(-1)!, 'http://helprr.test').searchParams;

const defaultFetch = fetchMock.getMockImplementation()!;

beforeEach(() => {
  mocks.jellyfin = false;
  fetchMock.mockClear();
  fetchMock.mockImplementation(defaultFetch);
  vi.stubGlobal('fetch', fetchMock);
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} });
  // A phone: the filters open as the bottom drawer.
  vi.stubGlobal('matchMedia', () => ({ matches: true, addEventListener() {}, removeEventListener() {} }));
  useUIStore.setState({ randomFilters: { ...DEFAULT_RANDOM_WATCH_PREFS }, hasHydrated: true });
});

const renderView = () => render(
  <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <RandomWatchView />
  </QueryClientProvider>,
);

describe('Random genre and length filters', () => {
  it('lists the library genres, and rolls and remembers the chosen genre and length', async () => {
    const user = userEvent.setup();
    renderView();
    await waitFor(() => expect(rollUrls()).toHaveLength(1));
    expect(lastRoll().getAll('genre')).toEqual([]);
    expect(lastRoll().get('runtime')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = within(await screen.findByRole('dialog'));
    await user.click(await sheet.findByRole('button', { name: 'Comedy' }));
    await waitFor(() => expect(lastRoll().getAll('genre')).toEqual(['Comedy']));
    await user.click(sheet.getByRole('button', { name: 'Under 90 min' }));
    await waitFor(() => expect(lastRoll().get('runtime')).toBe('under90'));

    expect(useUIStore.getState().randomFilters).toMatchObject({ genres: ['Comedy'], runtime: 'under90' });
    // The open drawer hides the page from assistive tech.
    expect(screen.getByRole('button', { name: 'Filters · 2', hidden: true })).toBeDefined();

    await user.click(sheet.getByRole('button', { name: 'Any genre' }));
    await waitFor(() => expect(lastRoll().getAll('genre')).toEqual([]));
    // Without a linked Jellyfin account there is no Unwatched choice.
    expect(sheet.queryByRole('button', { name: 'Unwatched only' })).toBeNull();
  });

  it('waits for the saved choice before the first roll', async () => {
    useUIStore.setState({ hasHydrated: false, randomFilters: { type: 'movie', unwatched: false, genres: [], runtime: 'any' } });
    renderView();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(rollUrls()).toHaveLength(0);
    useUIStore.setState({ hasHydrated: true });
    await waitFor(() => expect(rollUrls()).toHaveLength(1));
    expect(lastRoll().get('type')).toBe('movie');
  });

  it('starts with the choice this device saved last time', async () => {
    useUIStore.setState({ randomFilters: { type: 'movie', unwatched: false, genres: ['Drama'], runtime: 'over120' } });
    renderView();
    await waitFor(() => expect(rollUrls()).toHaveLength(1));
    expect(lastRoll().get('type')).toBe('movie');
    expect(lastRoll().getAll('genre')).toEqual(['Drama']);
    expect(lastRoll().get('runtime')).toBe('over120');
  });

  it('sets the length aside, and hides it, when only series are wanted', async () => {
    useUIStore.setState({ randomFilters: { type: 'series', unwatched: false, genres: [], runtime: 'over120' } });
    const user = userEvent.setup();
    renderView();
    await waitFor(() => expect(rollUrls()).toHaveLength(1));
    expect(lastRoll().get('runtime')).toBeNull();
    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.queryByRole('button', { name: 'Over 2 hours' })).toBeNull();
    expect(await sheet.findByRole('button', { name: 'Drama' })).toBeDefined();
  });

  it('keeps the chosen genres when one more than the limit is ticked', async () => {
    const chosen = Array.from({ length: MAX_RANDOM_GENRES }, (_, i) => `G${String(i).padStart(2, '0')}`);
    useUIStore.setState({ randomFilters: { type: 'any', unwatched: false, genres: chosen, runtime: 'any' } });
    fetchMock.mockImplementation(async () => Response.json({ pick: null, poolSize: 0, genres: [...chosen, 'Zombie'] }));
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: `Filters · ${MAX_RANDOM_GENRES}` }));
    await user.click(await within(await screen.findByRole('dialog')).findByRole('button', { name: 'Zombie' }));
    expect(useUIStore.getState().randomFilters.genres).toEqual(chosen);
  });

  it('carries the filters into the pick start sheet', async () => {
    useUIStore.setState({ randomFilters: { type: 'any', unwatched: false, genres: ['Comedy'], runtime: 'under90' } });
    const user = userEvent.setup();
    renderView();
    await user.click(screen.getByRole('button', { name: 'Pick together' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(sheet.getByText(/Movies and series · Under 90 min \(movies\) · Comedy\./)).toBeDefined();
    await user.click(await sheet.findByRole('checkbox', { name: 'Invite Mum' }));
    await user.click(sheet.getByRole('button', { name: /Start/ }));
    await waitFor(() => expect(fetchMock.mock.calls.some(([url]) => url === '/api/tonight')).toBe(true));
    const [, init] = fetchMock.mock.calls.find(([url]) => url === '/api/tonight') as unknown as [string, RequestInit];
    expect(JSON.parse(String(init.body))).toEqual({ type: 'any', watch: 'all', genres: ['Comedy'], runtime: 'under90', inviteeIds: ['mum'] });
  });

  it('keeps Unwatched only in the Filters menu and counts it', async () => {
    mocks.jellyfin = true;
    const user = userEvent.setup();
    renderView();
    await waitFor(() => expect(rollUrls()).toHaveLength(1));
    expect(lastRoll().get('watch')).toBe('all');

    await user.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = within(await screen.findByRole('dialog'));
    await user.click(sheet.getByRole('button', { name: 'Unwatched only' }));
    await waitFor(() => expect(lastRoll().get('watch')).toBe('unwatched'));
    expect(useUIStore.getState().randomFilters).toMatchObject({ unwatched: true });
    expect(screen.getByRole('button', { name: 'Filters · 1', hidden: true })).toBeDefined();
  });
});

describe('Random toolbar on a phone', () => {
  it('reaches Pick together and the pool size from the ⋯ action sheet', async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === '/api/tonight/members') return Response.json({ members: [] });
      return Response.json({ pick: null, poolSize: 42, genres: [] });
    });
    const user = userEvent.setup();
    renderView();
    // From lg up the button sits in the row; below lg only the ⋯ shows.
    expect(screen.getByRole('button', { name: 'Pick together' }).className).toMatch(/\bhidden\b.*\blg:inline-flex\b/);
    expect(screen.getByRole('button', { name: 'More actions' }).className).toMatch(/\blg:hidden\b/);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    const sheet = within(await screen.findByRole('dialog'));
    expect(await sheet.findByText('Pool: 42')).toBeDefined();
    await user.click(sheet.getByRole('button', { name: 'Pick together' }));
    const start = within(await screen.findByRole('dialog', { name: 'Pick together' }));
    expect(start.getByRole('button', { name: 'Choose who to invite' })).toBeDefined();
  });
});
