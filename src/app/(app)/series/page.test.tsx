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
vi.mock('@/components/permission-provider', () => ({
  useMe: () => null,
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
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} unobserve() {} });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
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
