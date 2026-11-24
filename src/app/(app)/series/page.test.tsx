// @vitest-environment jsdom
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { useUIStore } from '@/lib/store';
import SeriesPage from './page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/series',
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock('@/components/layout/navigation-provider', () => ({
  useAppRouter: () => ({ push: vi.fn() }),
  useNavigation: () => null,
}));
const permissions = vi.hoisted(() => ({ me: null as null | { role: string } }));
const viewport = vi.hoisted(() => ({ width: 1440 }));
vi.mock('@/components/permission-provider', () => ({
  useMe: () => permissions.me,
  useCan: () => false,
  hasCapability: () => false,
}));
vi.mock('@/components/jellyfin/watch-status-provider', () => ({
  useWatchLookup: () => () => undefined,
  useWatchMapReady: () => false,
  useWatchStatus: () => ({ canWrite: false, isWriting: false }),
}));
vi.mock('@/components/ui/pull-to-refresh', () => ({ PullToRefresh: () => null }));

beforeEach(() => {
  permissions.me = null;
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  viewport.width = 1440;
  // useIsMobile asks `(max-width: Npx)` and caches one query object per width,
  // so the answer is read live against the test's viewport width.
  vi.stubGlobal('matchMedia', (query: string) => ({
    get matches() { return viewport.width <= Number(/max-width:\s*([\d.]+)px/.exec(query)?.[1] ?? Infinity); },
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TooltipProvider><SeriesPage /></TooltipProvider></QueryClientProvider>);
  return client;
}

it('says the device is offline, not to add a connection, while the first load is paused offline', async () => {
  onlineManager.setOnline(false);
  try {
    const client = renderPage();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No series found. Add your Sonarr connection in Settings.')).toBeNull();
    client.clear();
  } finally {
    onlineManager.setOnline(true);
  }
});

it('still points to Settings when an online load returns no series', async () => {
  const client = renderPage();
  expect(await screen.findByText('No series found. Add your Sonarr connection in Settings.')).toBeTruthy();
  expect(screen.queryByText("You're offline")).toBeNull();
  client.clear();
});

it('applies a sort and closes the menu on one pick, but keeps the multi-select filter open', async () => {
  useUIStore.setState({ seriesSort: 'title', seriesFilter: [] });
  const client = renderPage();
  await screen.findByText('No series found. Add your Sonarr connection in Settings.');

  await userEvent.click(screen.getByRole('button', { name: /^Sort: Title/ }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: 'Year' }));
  expect(useUIStore.getState().seriesSort).toBe('year');
  await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());

  await userEvent.click(screen.getByRole('button', { name: /^Filter/ }));
  await userEvent.click(within(await screen.findByRole('menu')).getByRole('menuitemcheckbox', { name: 'Monitored' }));
  expect(useUIStore.getState().seriesFilter).toEqual(['monitored']);
  expect(screen.getByRole('menu')).toBeTruthy();
  client.clear();
});

it('gives an admin the ⋯ menu with each instance\'s library commands, and a member none', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(String(url) === '/api/instances'
    ? [{ id: 'son-1', label: 'main', type: 'SONARR' }, { id: 'son-2', label: 'sonarr-anime', type: 'SONARR' }, { id: 'rad-1', label: 'main', type: 'RADARR' }]
    : [])));
  permissions.me = { role: 'member' };
  const memberClient = renderPage();
  await screen.findByText('No series found. Add your Sonarr connection in Settings.');
  expect(screen.queryByRole('button', { name: 'More actions' })).toBeNull();
  memberClient.clear();
  cleanup();

  permissions.me = { role: 'admin' };
  const client = renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  const menu = await screen.findByRole('menu');
  // One group per Sonarr instance, each named; Radarr's instance is not listed.
  await within(menu).findByText('main (Sonarr)');
  expect(within(menu).getByText('sonarr-anime')).toBeTruthy();
  expect(within(menu).getAllByRole('menuitem', { name: 'RSS Sync' })).toHaveLength(2);
  expect(within(menu).getAllByRole('menuitem', { name: 'Refresh all series' })).toHaveLength(2);
  expect(within(menu).queryByText(/Radarr/)).toBeNull();
  client.clear();
});

it('folds Select and the list refresh into an admin\'s ⋯ menu on the narrowest phones', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(String(url) === '/api/instances'
    ? [{ id: 'son-1', label: 'main', type: 'SONARR' }]
    : [])));
  // 366px: the row is 354px with Select and Add, so Select moves into the menu
  // below 367px (a 360px Android phone included).
  viewport.width = 366;
  // jsdom has no pointer capture, which the drawer asks for on a press inside it.
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  permissions.me = { role: 'admin' };
  const client = renderPage();
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  const sheet = await screen.findByRole('dialog', { name: 'More actions' });
  expect(within(sheet).getAllByRole('button').map((b) => b.textContent))
    .toEqual(['Select series', 'Refresh list', 'RSS Sync', 'Refresh all series', 'Cancel']);
  await userEvent.click(within(sheet).getByRole('button', { name: 'Select series' }));
  expect(await screen.findByRole('button', { name: 'Cancel selection' })).toBeTruthy();
  client.clear();
});

it('keeps Select on the row from 367px, where it fits, with only the refresh in the ⋯ menu', async () => {
  vi.stubGlobal('fetch', vi.fn(async (url: string) => Response.json(String(url) === '/api/instances'
    ? [{ id: 'son-1', label: 'main', type: 'SONARR' }]
    : [])));
  viewport.width = 367;
  HTMLElement.prototype.setPointerCapture ??= () => {};
  HTMLElement.prototype.releasePointerCapture ??= () => {};
  permissions.me = { role: 'admin' };
  const client = renderPage();
  // The CSS edge matches the menu's: the row's Select hides below 367px.
  expect((await screen.findByRole('button', { name: 'Select series' })).className).toContain('max-[367px]:hidden');
  await userEvent.click(await screen.findByRole('button', { name: 'More actions' }));
  const sheet = await screen.findByRole('dialog', { name: 'More actions' });
  expect(within(sheet).getAllByRole('button').map((b) => b.textContent))
    .toEqual(['Refresh list', 'RSS Sync', 'Refresh all series', 'Cancel']);
  client.clear();
});
