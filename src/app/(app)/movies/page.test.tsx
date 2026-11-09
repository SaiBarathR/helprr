// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider, onlineManager } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { queryKeys } from '@/lib/query-keys';
import { useUIStore } from '@/lib/store';
import MoviesPage from './page';

vi.mock('next/navigation', () => ({
  usePathname: () => '/movies',
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

let toolbarHeight: number;
let notifyToolbarResize: () => void;

beforeEach(() => {
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
  localStorage.clear();
  sessionStorage.clear();
  toolbarHeight = 132;
  useUIStore.setState({ moviesView: 'table', moviesSearch: '', moviesFilter: [], moviesInstanceFilter: 'all', moviesWatchFilter: 'all' });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1000);
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
    return { top: 0, width: 1000, height: this.classList.contains('page-toolbar') ? toolbarHeight : 0 } as DOMRect;
  });
  vi.stubGlobal('ResizeObserver', class {
    constructor(private callback: () => void) {}
    observe(element: Element) {
      if (element.classList.contains('page-toolbar')) notifyToolbarResize = this.callback;
    }
    disconnect() {}
    unobserve() {}
  });
  vi.stubGlobal('fetch', vi.fn(async () => Response.json([])));
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('supplies the measured Movies toolbar height to its sticky table and updates it', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(queryKeys.library('radarr'), [{ id: 1, title: 'Alien', sortTitle: 'alien', year: 1979, images: [], genres: [] }]);
  render(<QueryClientProvider client={client}><TooltipProvider><MoviesPage /></TooltipProvider></QueryClientProvider>);
  const table = await screen.findByRole('table');
  const toolbar = document.querySelector<HTMLElement>('.page-toolbar')!;
  expect(toolbar.parentElement?.style.getPropertyValue('--page-toolbar-height')).toBe('132px');
  expect(table.querySelector('th')?.classList.contains('sticky')).toBe(true);
  expect(table.querySelector('th')?.style.top).toContain('var(--page-toolbar-height,');
  toolbarHeight = 176;
  act(() => notifyToolbarResize());
  expect(toolbar.parentElement?.style.getPropertyValue('--page-toolbar-height')).toBe('176px');
  client.clear();
});

function renderEmptyPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><TooltipProvider><MoviesPage /></TooltipProvider></QueryClientProvider>);
  return client;
}

it('says the device is offline, not to add a connection, while the first load is paused offline', async () => {
  onlineManager.setOnline(false);
  try {
    const client = renderEmptyPage();
    expect(await screen.findByText("You're offline")).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
    expect(screen.queryByText('No movies found. Add your Radarr connection in Settings.')).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
    client.clear();
  } finally {
    onlineManager.setOnline(true);
  }
});

it('still points to Settings when an online load returns no movies', async () => {
  const client = renderEmptyPage();
  expect(await screen.findByText('No movies found. Add your Radarr connection in Settings.')).toBeTruthy();
  expect(screen.queryByText("You're offline")).toBeNull();
  client.clear();
});
